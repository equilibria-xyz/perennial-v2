// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Order.sol";

/// @dev Intent type
struct Intent {
    /// @dev The quantity of orders that are included in this intent
    uint256 intents;

    /// @dev The notional of the magnitude with the price override (local only)
    Fixed6 notional;

    /// @dev The positive skew maker intent size
    UFixed6 makerPos; // TODO: remove maker

    /// @dev The negative skew maker intent size
    UFixed6 makerNeg;

    /// @dev The positive skew long intent size
    UFixed6 longPos;

    /// @dev The negative skew long intent size
    UFixed6 longNeg;

    /// @dev The positive skew short intent size
    UFixed6 shortPos;

    /// @dev The negative skew short intent size
    UFixed6 shortNeg;
}
using IntentLib for Intent global;
struct IntentStorageGlobal { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using IntentStorageGlobalLib for IntentStorageGlobal global;
struct IntentStorageLocal { uint256 slot0; } // SECURITY: must remain at (1) slots
using IntentStorageLocalLib for IntentStorageLocal global;

/// @title Intent
/// @notice Holds the state for an account's update intent
library IntentLib {
    /// @notice Prepares the next intent from the current intent
    /// @param self The intent object to update
    function next(Intent memory self) internal pure  {
        invalidate(self);
        self.intents = 0;
    }

    /// @notice Invalidates the intent
    /// @param self The intent object to update
    function invalidate(Intent memory self) internal pure {
        (self.makerPos, self.makerNeg, self.longPos, self.longNeg, self.shortPos, self.shortNeg) =
            (UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO);
    } // TODO: used?

    /// @notice Creates a new intent from an order
    /// @param order The order to create the intent from
    /// @param priceOverride The price override
    /// @return newIntent The resulting intent
    function from(Order memory order, Fixed6 priceOverride) internal pure returns (Intent memory newIntent) {
        // zero price indicates no price override, maker orders cannot have a price override
        if (priceOverride.isZero() || !order.makerTotal().isZero()) return newIntent;

        (newIntent.intents, newIntent.longPos, newIntent.longNeg, newIntent.shortPos, newIntent.shortNeg) =
            (order.orders, order.longPos, order.longNeg, order.shortPos, order.shortNeg);

        newIntent.notional = taker(newIntent).mul(priceOverride);
    }

    /* TODO: Trim unused helpers */

    /// @notice Returns whether the intent is empty
    /// @param self The intent object to check
    /// @return Whether the intent is empty
    function isEmpty(Intent memory self) internal pure returns (bool) {
        return pos(self).isZero() && neg(self).isZero();
    }

     /// @notice Returns the direction of the intent
    /// @dev 0 = maker, 1 = long, 2 = short
    /// @param self The position object to check
    /// @return The direction of the position
    function direction(Intent memory self) internal pure returns (uint256) {
        if (!self.longPos.isZero() || !self.longNeg.isZero()) return 1;
        if (!self.shortPos.isZero() || !self.shortNeg.isZero()) return 2;

        return 0;
    }

    /// @notice Returns the magnitude of the intent
    /// @param self The intent object to check
    /// @return The magnitude of the intent
    function takerMagnitude(Intent memory self) internal pure returns (Fixed6) {
        return maker(self).add(long(self)).add(short(self));
    }

    /// @notice Returns the magnitude of the intent
    /// @param self The intent object to check
    /// @return The magnitude of the intent
    function magnitude(Intent memory self) internal pure returns (Fixed6) {
        return maker(self).add(long(self)).add(short(self));
    }

    /// @notice Returns the maker delta of the intent
    /// @param self The intent object to check
    /// @return The maker delta of the intent
    function maker(Intent memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.makerPos).sub(Fixed6Lib.from(self.makerNeg));
    }

    /// @notice Returns the taker delta of the intent
    /// @param self The intent object to check
    /// @return The taker delta of the intent
    function taker(Intent memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.takerPos()).sub(Fixed6Lib.from(self.takerNeg()));
    }

    /// @notice Returns the long delta of the intent
    /// @param self The intent object to check
    /// @return The long delta of the intent
    function long(Intent memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.longPos).sub(Fixed6Lib.from(self.longNeg));
    }

    /// @notice Returns the short delta of the intent
    /// @param self The intent object to check
    /// @return The short delta of the intent
    function short(Intent memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.shortPos).sub(Fixed6Lib.from(self.shortNeg));
    }

    /// @notice Returns the positive taker delta of the intent
    /// @param self The intent object to check
    /// @return The positive taker delta of the intent
    function takerPos(Intent memory self) internal pure returns (UFixed6) {
        return self.longPos.add(self.shortNeg);
    }

    /// @notice Returns the negative taker delta of the intent
    /// @param self The intent object to check
    /// @return The negative taker delta of the intent
    function takerNeg(Intent memory self) internal pure returns (UFixed6) {
        return self.shortPos.add(self.longNeg);
    }

    /// @notice Returns the total maker delta of the intent
    /// @param self The intent object to check
    /// @return The total maker delta of the intent
    function makerTotal(Intent memory self) internal pure returns (UFixed6) {
        return self.makerPos.add(self.makerNeg);
    }

    /// @notice Returns the total taker delta of the intent
    /// @param self The intent object to check
    /// @return The total taker delta of the intent
    function takerTotal(Intent memory self) internal pure returns (UFixed6) {
        return self.takerPos().add(self.takerNeg());
    }

    /// @notice Returns the positive delta of the intent
    /// @param self The intent object to check
    /// @return The positive delta of the intent
    function pos(Intent memory self) internal pure returns (UFixed6) {
        return self.makerPos.add(self.longPos).add(self.shortPos);
    }

    /// @notice Returns the positive delta of the intent
    /// @param self The intent object to check
    /// @return The positive delta of the intent
    function neg(Intent memory self) internal pure returns (UFixed6) {
        return self.makerNeg.add(self.longNeg).add(self.shortNeg);
    }

    /* TODO: Trim unused helpers */

    /// @notice Updates the current global intent with a new local intent
    /// @param self The intent object to update
    /// @param intent The new intent
    function add(Intent memory self, Intent memory intent) internal pure {
        self.intents = self.intents + intent.intents;
        (self.makerPos, self.makerNeg, self.longPos, self.longNeg, self.shortPos, self.shortNeg) = (
            self.makerPos.add(intent.makerPos),
            self.makerNeg.add(intent.makerNeg),
            self.longPos.add(intent.longPos),
            self.longNeg.add(intent.longNeg),
            self.shortPos.add(intent.shortPos),
            self.shortNeg.add(intent.shortNeg)
        );
    }

    /// @notice Subtracts the latest local intent from current global intent
    /// @param self The intent object to update
    /// @param intent The latest intent
    function sub(Intent memory self, Intent memory intent) internal pure {
        self.intents = self.intents - intent.intents;

        (self.makerPos, self.makerNeg, self.longPos, self.longNeg, self.shortPos, self.shortNeg) = (
            self.makerPos.sub(intent.makerPos),
            self.makerNeg.sub(intent.makerNeg),
            self.longPos.sub(intent.longPos),
            self.longNeg.sub(intent.longNeg),
            self.shortPos.sub(intent.shortPos),
            self.shortNeg.sub(intent.shortNeg)
        );
    }
}

/// @dev Manually encodes and decodes the global Intent struct into storage.
///
///     struct StoredIntentGlobal {
///         /* slot 0 */
///         uint32 intents;
///         uint64 makerPos;
///         uint64 makerNeg;
///
///         /* slot 1 */
///         uint64 longPos;
///         uint64 longNeg;
///         uint64 shortPos;
///         uint64 shortNeg;
///     }
///
library IntentStorageGlobalLib {
    function read(IntentStorageGlobal storage self) internal view returns (Intent memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);

        return Intent(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6Lib.ZERO,
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(IntentStorageGlobal storage self, Intent memory newValue) internal {
        IntentStorageLib.validate(newValue);

        if (newValue.makerPos.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.makerNeg.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.longPos.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.longNeg.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.shortPos.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.shortNeg.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.intents << (256 - 32)) >> (256 - 32) |
            uint256(UFixed6.unwrap(newValue.makerPos) << (256 - 64)) >> (256 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.makerNeg) << (256 - 64)) >> (256 - 32 - 64 - 64);
        uint256 encoded1 =
            uint256(UFixed6.unwrap(newValue.longPos) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.longNeg) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortPos) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortNeg) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}

/// @dev Manually encodes and decodes the local Intent struct into storage.
///
///     struct StoredIntentLocal {
///         /* slot 0 */
///         uint32 intents;
///         int64 notional;
///         uint2 direction;
///         uint62 magnitudePos;
///         uint62 magnitudeNeg;
///     }
///
library IntentStorageLocalLib {
    function read(IntentStorageLocal storage self) internal view returns (Intent memory) {
        uint256 slot0 = self.slot0;

        uint256 direction = uint256(slot0 << (256 - 32 - 64 - 2)) >> (256 - 2);
        UFixed6 magnitudePos = UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 2 - 62)) >> (256 - 62));
        UFixed6 magnitudeNeg = UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 2 - 62 - 62)) >> (256 - 62));

        return Intent(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            direction == 0 ? magnitudePos : UFixed6Lib.ZERO,
            direction == 0 ? magnitudeNeg : UFixed6Lib.ZERO,
            direction == 1 ? magnitudePos : UFixed6Lib.ZERO,
            direction == 1 ? magnitudeNeg : UFixed6Lib.ZERO,
            direction == 2 ? magnitudePos : UFixed6Lib.ZERO,
            direction == 2 ? magnitudeNeg : UFixed6Lib.ZERO
        );
    }

    function store(IntentStorageLocal storage self, Intent memory newValue) internal {
        IntentStorageLib.validate(newValue);

        (UFixed6 magnitudePos, UFixed6 magnitudeNeg) = (newValue.pos(), newValue.neg());

        if (magnitudePos.gt(UFixed6.wrap(2 ** 62 - 1))) revert IntentStorageLib.IntentStorageInvalidError();
        if (magnitudeNeg.gt(UFixed6.wrap(2 ** 62 - 1))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.notional.gt(Fixed6.wrap(type(int64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.notional.lt(Fixed6.wrap(type(int64).min))) revert IntentStorageLib.IntentStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.intents << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.notional) << (256 - 64)) >> (256 - 32 - 64) |
            uint256(newValue.direction() << (256 - 2)) >> (256 - 32 - 64 - 2) |
            uint256(UFixed6.unwrap(magnitudePos) << (256 - 62)) >> (256 - 32 - 64 - 2 - 62) |
            uint256(UFixed6.unwrap(magnitudeNeg) << (256 - 62)) >> (256 - 32 - 64 - 2 - 62 - 62);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

library IntentStorageLib {
    // sig: TODO
    error IntentStorageInvalidError();

    function validate(Intent memory newValue) internal pure {
        if (newValue.intents > type(uint32).max) revert IntentStorageInvalidError();
    }
}