// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Order.sol";

/// @dev Intent type
struct Intent {
    /// @dev The quantity of orders that are included in this intent
    uint256 intents;

    /// @dev The notional of the magnitude with the price override (local only)
    Fixed6 notional;

    /// @dev The positive skew (open long / close short) intent size
    UFixed6 takerPos;

    /// @dev The negative skew (close long / open short) intent size
    UFixed6 takerNeg;
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
        (self.takerPos, self.takerNeg) = (UFixed6Lib.ZERO, UFixed6Lib.ZERO);
    }

    /// @notice Creates a new intent from an order
    /// @param order The order to create the intent from
    /// @param priceOverride The price override
    /// @return newIntent The resulting intent
    function from(Order memory order, Fixed6 priceOverride) internal pure returns (Intent memory newIntent) {
        // zero price indicates no price override, maker orders cannot have a price override
        if (priceOverride.isZero() || !order.makerTotal().isZero()) return newIntent;

        (newIntent.intents, newIntent.takerPos, newIntent.takerNeg) =
            (order.orders, order.longPos.add(order.shortNeg), order.longNeg.add(order.shortPos));

        newIntent.notional = taker(newIntent).mul(priceOverride);
    }

    /// @notice Returns the taker delta of the intent
    /// @param self The intent object to check
    /// @return The taker delta of the intent
    function taker(Intent memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.takerPos).sub(Fixed6Lib.from(self.takerNeg));
    }

    /// @notice Returns the total taker delta of the intent
    /// @param self The intent object to check
    /// @return The total taker delta of the intent
    function takerTotal(Intent memory self) internal pure returns (UFixed6) {
        return self.takerPos.add(self.takerNeg);
    }

    /// @notice Updates the current global intent with a new local intent
    /// @param self The intent object to update
    /// @param intent The new intent
    function add(Intent memory self, Intent memory intent) internal pure {
        self.intents = self.intents + intent.intents;
        (self.takerPos, self.takerNeg) = (self.takerPos.add(intent.takerPos), self.takerNeg.add(intent.takerNeg));
    }

    /// @notice Subtracts the latest local intent from current global intent
    /// @param self The intent object to update
    /// @param intent The latest intent
    function sub(Intent memory self, Intent memory intent) internal pure {
        self.intents = self.intents - intent.intents;
        (self.takerPos, self.takerNeg) = (self.takerPos.sub(intent.takerPos), self.takerNeg.sub(intent.takerNeg));
    }
}

/// @dev Manually encodes and decodes the global Intent struct into storage.
///
///     struct StoredIntentGlobal {
///         /* slot 0 */
///         uint32 intents;
///         uint64 takerPos;
///         uint64 takerNeg;
///     }
///
library IntentStorageGlobalLib {
    function read(IntentStorageGlobal storage self) internal view returns (Intent memory) {
        uint256 slot0 = self.slot0;
        return Intent(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6Lib.ZERO,
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(IntentStorageGlobal storage self, Intent memory newValue) internal {
        IntentStorageLib.validate(newValue);

        uint256 encoded0 =
            uint256(newValue.intents << (256 - 32)) >> (256 - 32) |
            uint256(UFixed6.unwrap(newValue.takerPos) << (256 - 64)) >> (256 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.takerNeg) << (256 - 64)) >> (256 - 32 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

/// @dev Manually encodes and decodes the local Intent struct into storage.
///
///     struct StoredIntentLocal {
///         /* slot 0 */
///         uint32 intents;
///         int64 notional;
///         uint64 takerPos;
///         uint64 takerNeg;
///     }
///
library IntentStorageLocalLib {
    function read(IntentStorageLocal storage self) internal view returns (Intent memory) {
        uint256 slot0 = self.slot0;
        return Intent(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(IntentStorageLocal storage self, Intent memory newValue) internal {
        IntentStorageLib.validate(newValue);

        if (newValue.notional.gt(Fixed6.wrap(type(int64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.notional.lt(Fixed6.wrap(type(int64).min))) revert IntentStorageLib.IntentStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.intents << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.notional) << (256 - 64)) >> (256 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.takerPos) << (256 - 64)) >> (256 - 32 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.takerNeg) << (256 - 64)) >> (256 - 32 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

library IntentStorageLib {
    // sig: 0xeda870c1
    error IntentStorageInvalidError();

    function validate(Intent memory newValue) internal pure {
        if (newValue.intents > type(uint32).max) revert IntentStorageInvalidError();
        if (newValue.takerPos.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();
        if (newValue.takerNeg.gt(UFixed6.wrap(type(uint64).max))) revert IntentStorageLib.IntentStorageInvalidError();
    }
}