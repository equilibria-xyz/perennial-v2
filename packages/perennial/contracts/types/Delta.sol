// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Order.sol";
import "./Global.sol";
import "./Local.sol";
import "./Invalidation.sol";

/// @dev Order type
struct Delta {
    /// @dev The timestamp of the delta
    uint256 timestamp;

    /// @dev The quantity of orders that are included in this delta
    uint256 orders;

    /// @dev The maker delta
    Fixed6 maker;

    /// @dev The long delta
    Fixed6 long;

    /// @dev The short delta
    Fixed6 short;

    /// @dev The positive skew maker order size
    UFixed6 makerPos;

    /// @dev The negative skew maker order size
    UFixed6 makerNeg;

    /// @dev The positive skew taker order size
    UFixed6 takerPos;

    /// @dev The negative skew taker order size
    UFixed6 takerNeg;
}
using DeltaLib for Delta global;
struct DeltaStorageGlobal { uint256 slot0; uint256 slot1; }
using DeltaStorageGlobalLib for DeltaStorageGlobal global;
struct DeltaStorageLocal { uint256 slot0; }
using DeltaStorageLocalLib for DeltaStorageLocal global;

/// @title Delta
/// @notice Holds the state for a delta
library DeltaLib {
    function from(
        uint256 timestamp,
        uint256 orders,
        Fixed6 maker,
        Fixed6 long,
        Fixed6 short
    ) internal pure returns (Delta memory) {
        return Delta(
            timestamp,
            orders,
            maker,
            long,
            short,
            maker.max(Fixed6Lib.ZERO).abs(),
            maker.min(Fixed6Lib.ZERO).abs(),
            long.sub(short).max(Fixed6Lib.ZERO).abs(),
            long.sub(short).min(Fixed6Lib.ZERO).abs()
        );
    }

    /// @notice Creates a new delta from the current position and an update request
    /// @param timestamp The current timestamp
    /// @param position The current position
    /// @param newMaker The new maker
    /// @param newLong The new long
    /// @param newShort The new short
    /// @return newDelta The resulting order
    function from(
        uint256 timestamp,
        Position memory position,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort
    ) internal pure returns (Delta memory newDelta) {
        newDelta = from(
            timestamp,
            0,
            Fixed6Lib.from(newMaker).sub(Fixed6Lib.from(position.maker)),
            Fixed6Lib.from(newLong).sub(Fixed6Lib.from(position.long)),
            Fixed6Lib.from(newShort).sub(Fixed6Lib.from(position.short))
        );
        if (!empty(newDelta)) newDelta.orders = 1;
    }

    function empty(Delta memory self) internal pure returns (bool) {
        return self.maker.isZero() && self.long.isZero() && self.short.isZero();
    }

    /// @notice Updates the current global delta with a new local delta
    /// @param self The delta object to update
    /// @param delta The new delta
    function add(Delta memory self, Delta memory delta) internal pure {
        (self.timestamp, self.maker, self.long, self.short) = (
            delta.timestamp,
            self.maker.add(delta.maker),
            self.long.add(delta.long),
            self.short.add(delta.short)
        );

        (self.orders, self.makerPos, self.makerNeg, self.takerPos, self.takerNeg) = (
            self.orders + delta.orders,
            self.makerPos.add(delta.makerPos),
            self.makerNeg.add(delta.makerNeg),
            self.takerPos.add(delta.takerPos),
            self.takerNeg.add(delta.takerNeg)
        );
    }
}

/// @dev Manually encodes and decodes the global Delta struct into storage.
///
///     struct StoredDeltaGlobal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint32 orders;
///         int64 long;
///         int64 short;
///         uint64 __unallocated__;
///
///         /* slot 2 */
///         uint64 makerPos;
///         uint64 makerNeg;
///         uint64 takerPos;
///         uint64 takerNeg;
///     }
///
library DeltaStorageGlobalLib {
    function read(DeltaStorageGlobal storage self) internal view returns (Delta memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);

        UFixed6 makerPos = UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64));
        UFixed6 makerNeg = UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64));

        return Delta(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            Fixed6Lib.from(makerPos).sub(Fixed6Lib.from(makerNeg)),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64 - 64)) >> (256 - 64)),
            makerPos,
            makerNeg,
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64 - 64 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64 - 64 - 64 - 64))
        );
    }

    function store(DeltaStorageGlobal storage self, Delta memory newValue) internal {
        DeltaStorageLib.validate(newValue);

        if (newValue.maker.gt(Fixed6.wrap(type(int64).max))) revert DeltaStorageLib.DeltaStorageInvalidError();
        if (newValue.maker.lt(Fixed6.wrap(type(int64).min))) revert DeltaStorageLib.DeltaStorageInvalidError();
        if (newValue.long.gt(Fixed6.wrap(type(int64).max))) revert DeltaStorageLib.DeltaStorageInvalidError();
        if (newValue.long.lt(Fixed6.wrap(type(int64).min))) revert DeltaStorageLib.DeltaStorageInvalidError();
        if (newValue.short.gt(Fixed6.wrap(type(int64).max))) revert DeltaStorageLib.DeltaStorageInvalidError();
        if (newValue.short.lt(Fixed6.wrap(type(int64).min))) revert DeltaStorageLib.DeltaStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(newValue.orders << (256 - 32)) >> (256 - 32 - 32) |
            uint256(Fixed6.unwrap(newValue.long) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(Fixed6.unwrap(newValue.short) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64);
        uint256 encoded1 =
            uint256(UFixed6.unwrap(newValue.makerPos) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.makerNeg) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.takerPos) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.takerNeg) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}

/// @dev Manually encodes and decodes the local Delta struct into storage.
///
///     struct StoredDeltaLocal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint2 direction;
///         int62 magnitude;
///     }
///
library DeltaStorageLocalLib {
    function read(DeltaStorageLocal storage self) internal view returns (Delta memory) {
        uint256 slot0 = self.slot0;

        uint256 direction = uint256(slot0 << (256 - 2)) >> (256 - 2);
        Fixed6 magnitude = Fixed6.wrap(int256(slot0 << (256 - 2 - 62)) >> (256 - 62));

        return DeltaLib.from(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            magnitude.isZero() ? 0 : 1,
            direction == 0 ? magnitude : Fixed6Lib.ZERO,
            direction == 1 ? magnitude : Fixed6Lib.ZERO,
            direction == 2 ? magnitude : Fixed6Lib.ZERO
        );
    }

    function store(DeltaStorageLocal storage self, Delta memory newValue) internal {
        DeltaStorageLib.validate(newValue);

        uint256 direction = newValue.long.isZero() ? (newValue.short.isZero() ? 0 : 2) : 1;
        Fixed6 magnitude = newValue.maker.add(newValue.long).add(newValue.short);

        if (magnitude.gt(Fixed6.wrap(2 ** 61 - 1))) revert DeltaStorageLib.DeltaStorageInvalidError();

        uint256 encoded =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(direction << (256 - 2)) >> (256 - 32 - 2) |
            uint256(Fixed6.unwrap(magnitude) << (256 - 62)) >> (256 - 32 - 2 - 62);

        assembly {
            sstore(self.slot, encoded)
        }
    }
}

library DeltaStorageLib {
    // sig: TODO
    error DeltaStorageInvalidError();

    function validate(Delta memory newValue) internal pure {
        if (newValue.timestamp > type(uint32).max) revert DeltaStorageInvalidError();
        if (newValue.orders > type(uint32).max) revert DeltaStorageInvalidError();
        if (newValue.makerPos.gt(UFixed6.wrap(type(uint64).max))) revert DeltaStorageInvalidError();
        if (newValue.makerNeg.gt(UFixed6.wrap(type(uint64).max))) revert DeltaStorageInvalidError();
        if (newValue.takerPos.gt(UFixed6.wrap(type(uint64).max))) revert DeltaStorageInvalidError();
        if (newValue.takerNeg.gt(UFixed6.wrap(type(uint64).max))) revert DeltaStorageInvalidError();
    }
}