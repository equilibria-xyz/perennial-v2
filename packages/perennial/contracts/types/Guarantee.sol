// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Order.sol";

/// @dev Guarantee type
struct Guarantee {
    /// @dev The quantity of orders that are included in this guarantee
    uint256 orders;

    /// @dev The notional of the magnitude with the price override (local only)
    Fixed6 notional;

    /// @dev The positive skew (open long / close short) guarantee size
    UFixed6 takerPos;

    /// @dev The negative skew (close long / open short) guarantee size
    UFixed6 takerNeg;
}
using GuaranteeLib for Guarantee global;
struct GuaranteeStorageGlobal { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using GuaranteeStorageGlobalLib for GuaranteeStorageGlobal global;
struct GuaranteeStorageLocal { uint256 slot0; } // SECURITY: must remain at (1) slots
using GuaranteeStorageLocalLib for GuaranteeStorageLocal global;

/// @title Guarantee
/// @notice Holds the state for an account's update guarantee
library GuaranteeLib {
    /// @notice Prepares the next guarantee from the current guarantee
    /// @param self The guarantee object to update
    function next(Guarantee memory self) internal pure  {
        invalidate(self);
        self.orders = 0;
    }

    /// @notice Invalidates the guarantee
    /// @param self The guarantee object to update
    function invalidate(Guarantee memory self) internal pure {
        (self.takerPos, self.takerNeg, self.notional) = (UFixed6Lib.ZERO, UFixed6Lib.ZERO, Fixed6Lib.ZERO);
    }

    /// @notice Creates a new guarantee from an order
    /// @param order The order to create the guarantee from
    /// @param priceOverride The price override
    /// @param settlementFee Whether the order will still be charged the settlement fee
    /// @return newGuarantee The resulting guarantee
    function from(
        Order memory order,
        Fixed6 priceOverride,
        bool settlementFee
    ) internal pure returns (Guarantee memory newGuarantee) {
        // maker orders and one intent order per fill will be required to pay the settlement fee
        if (!order.takerTotal().isZero() && !settlementFee) newGuarantee.orders = order.orders;

        (newGuarantee.takerPos, newGuarantee.takerNeg) =
            (order.longPos.add(order.shortNeg), order.longNeg.add(order.shortPos));

        newGuarantee.notional = taker(newGuarantee).mul(priceOverride);
    }

    /// @notice Returns the taker delta of the guarantee
    /// @param self The guarantee object to check
    /// @return The taker delta of the guarantee
    function taker(Guarantee memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.takerPos).sub(Fixed6Lib.from(self.takerNeg));
    }

    /// @notice Returns the total taker delta of the guarantee
    /// @param self The guarantee object to check
    /// @return The total taker delta of the guarantee
    function takerTotal(Guarantee memory self) internal pure returns (UFixed6) {
        return self.takerPos.add(self.takerNeg);
    }

    /// @notice Updates the current global guarantee with a new local guarantee
    /// @param self The guarantee object to update
    /// @param guarantee The new guarantee
    function add(Guarantee memory self, Guarantee memory guarantee) internal pure {
        self.orders = self.orders + guarantee.orders;
        (self.takerPos, self.takerNeg, self.notional) = (
            self.takerPos.add(guarantee.takerPos),
            self.takerNeg.add(guarantee.takerNeg),
            self.notional.add(guarantee.notional)
        );
    }
}

/// @dev Manually encodes and decodes the global Guarantee struct into storage.
///
///     struct StoredGuaranteeGlobal {
///         /* slot 0 */
///         uint32 orders;
///         uint64 takerPos;
///         uint64 takerNeg;
///     }
///
library GuaranteeStorageGlobalLib {
    function read(GuaranteeStorageGlobal storage self) internal view returns (Guarantee memory) {
        uint256 slot0 = self.slot0;
        return Guarantee(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6Lib.ZERO,
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(GuaranteeStorageGlobal storage self, Guarantee memory newValue) internal {
        GuaranteeStorageLib.validate(newValue);

        uint256 encoded0 =
            uint256(newValue.orders << (256 - 32)) >> (256 - 32) |
            uint256(UFixed6.unwrap(newValue.takerPos) << (256 - 64)) >> (256 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.takerNeg) << (256 - 64)) >> (256 - 32 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

/// @dev Manually encodes and decodes the local Guarantee struct into storage.
///
///     struct StoredGuaranteeLocal {
///         /* slot 0 */
///         uint32 orders;
///         int64 notional;
///         uint64 takerPos;
///         uint64 takerNeg;
///     }
///
library GuaranteeStorageLocalLib {
    function read(GuaranteeStorageLocal storage self) internal view returns (Guarantee memory) {
        uint256 slot0 = self.slot0;
        return Guarantee(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(GuaranteeStorageLocal storage self, Guarantee memory newValue) internal {
        GuaranteeStorageLib.validate(newValue);

        if (newValue.notional.gt(Fixed6.wrap(type(int64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.notional.lt(Fixed6.wrap(type(int64).min))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.orders << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.notional) << (256 - 64)) >> (256 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.takerPos) << (256 - 64)) >> (256 - 32 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.takerNeg) << (256 - 64)) >> (256 - 32 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

library GuaranteeStorageLib {
    // sig: 0xfd030f36
    error GuaranteeStorageInvalidError();

    function validate(Guarantee memory newValue) internal pure {
        if (newValue.orders > type(uint32).max) revert GuaranteeStorageInvalidError();
        if (newValue.takerPos.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.takerNeg.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
    }
}