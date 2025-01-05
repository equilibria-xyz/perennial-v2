// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { Order } from "./Order.sol";

/// @dev Guarantee type
struct Guarantee {
    /// @dev The quantity of guarantees that that will be exempt from the settlement fee
    uint256 orders;

    /// @dev The notional of the magnitude with the price override (local only)
    Fixed6 notional;

    /// @dev The long open guarantee size
    UFixed6 longPos;

    /// @dev The long close guarantee size
    UFixed6 longNeg;

    /// @dev The short open guarantee size
    UFixed6 shortPos;

    /// @dev The short close guarantee size
    UFixed6 shortNeg;

    /// @dev The magnitude of the guarantee that be exempt from the trade fee
    UFixed6 takerFee;

    /// @dev The referral fee multiplied by the size applicable to the referral (local only)
    UFixed6 referral;
}
using GuaranteeLib for Guarantee global;
struct GuaranteeStorageGlobal { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using GuaranteeStorageGlobalLib for GuaranteeStorageGlobal global;
struct GuaranteeStorageLocal { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using GuaranteeStorageLocalLib for GuaranteeStorageLocal global;

/// @title Guarantee
/// @dev (external-unsafe): this library must be used internally only
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
        (self.longPos, self.longNeg, self.shortPos, self.shortNeg, self.notional, self.takerFee, self.referral) =
            (UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, Fixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO);
    }

    /// @notice Creates a new guarantee from an order
    /// @param order The order to create the guarantee from
    /// @param priceOverride The price override
    /// @param referralFee The the percentage of the subtractive fee to take as a solver referral fee
    /// @param chargeSettlementFee Whether the order will still be charged the settlement fee
    /// @param chargeTradeFee Whether the order will still be charged the trade fee
    /// @return newGuarantee The resulting guarantee
    function from(
        Order memory order,
        Fixed6 priceOverride,
        UFixed6 referralFee,
        bool chargeSettlementFee,
        bool chargeTradeFee
    ) internal pure returns (Guarantee memory newGuarantee) {
        // maker orders and one intent order per fill will be required to pay the settlement fee
        if (!order.takerTotal().isZero() && !chargeSettlementFee) newGuarantee.orders = order.orders;

        (newGuarantee.longPos, newGuarantee.longNeg, newGuarantee.shortPos, newGuarantee.shortNeg) =
            (order.longPos, order.longNeg, order.shortPos, order.shortNeg);
        newGuarantee.takerFee = chargeTradeFee ? UFixed6Lib.ZERO : order.takerTotal();

        newGuarantee.notional = taker(newGuarantee).mul(priceOverride);
        newGuarantee.referral = order.takerReferral.mul(referralFee);
    }

    /// @notice Returns the positive side of the taker position of the guarantee
    /// @param self The guarantee object to check
    /// @return The positive side of the taker position of the guarantee
    function takerPos(Guarantee memory self) internal pure returns (UFixed6) {
        return self.longPos.add(self.shortNeg);
    }

    /// @notice Returns the negative side of the taker position of the guarantee
    /// @param self The guarantee object to check
    /// @return The negative side of the taker position of the guarantee
    function takerNeg(Guarantee memory self) internal pure returns (UFixed6) {
        return self.longNeg.add(self.shortPos);
    }

    /// @notice Returns the taker delta of the guarantee
    /// @param self The guarantee object to check
    /// @return The taker delta of the guarantee
    function taker(Guarantee memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(takerPos(self)).sub(Fixed6Lib.from(takerNeg(self)));
    }

    /// @notice Returns the total taker delta of the guarantee
    /// @param self The guarantee object to check
    /// @return The total taker delta of the guarantee
    function takerTotal(Guarantee memory self) internal pure returns (UFixed6) {
        return takerPos(self).add(takerNeg(self));
    }

    /// @notice Returns the collateral adjusted due to the price override
    /// @param self The guarantee object to check
    /// @param price The oracle price to compare to the price override
    /// @return The collateral adjusted due to the price override
    function priceAdjustment(Guarantee memory self, Fixed6 price) internal pure returns (Fixed6) {
        return self.taker().mul(price).sub(self.notional);
    }

    /// @notice Returns the price deviation of the guarantee from the oracle price
    /// @dev The price deviation is the difference between the prices over the closest price to zero
    ///      Only supports new guarantees for updates, does not work for aggregated guarantees (local / global)
    /// @param self The guarantee object to check
    /// @param price The oracle price to compare
    /// @return The price deviation of the guarantee from the oracle price
    function priceDeviation(Guarantee memory self, Fixed6 price) internal pure returns (UFixed6) {
        if (takerTotal(self).isZero()) return UFixed6Lib.ZERO;

        Fixed6 guaranteePrice = self.notional.div(taker(self));
        return guaranteePrice.sub(price).abs().unsafeDiv(guaranteePrice.abs().min(price.abs()));
    }

    /// @notice Updates the current global guarantee with a new local guarantee
    /// @param self The guarantee object to update
    /// @param guarantee The new guarantee
    function add(Guarantee memory self, Guarantee memory guarantee) internal pure {
        self.orders = self.orders + guarantee.orders;
        (self.notional, self.longPos, self.longNeg, self.shortPos, self.shortNeg, self.takerFee, self.referral) = (
            self.notional.add(guarantee.notional),
            self.longPos.add(guarantee.longPos),
            self.longNeg.add(guarantee.longNeg),
            self.shortPos.add(guarantee.shortPos),
            self.shortNeg.add(guarantee.shortNeg),
            self.takerFee.add(guarantee.takerFee),
            self.referral.add(guarantee.referral)
        );
    }
}

/// @dev Manually encodes and decodes the global Guarantee struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredGuaranteeGlobal {
///         /* slot 0 */
///         uint32 orders;
///         uint64 takerFee;
///
///         /* slot 1 */
///         uint64 longPos;
///         uint64 longNeg;
///         uint64 shortPos;
///         uint64 shortNeg;
///     }
///
library GuaranteeStorageGlobalLib {
    function read(GuaranteeStorageGlobal storage self) internal view returns (Guarantee memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return Guarantee(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6Lib.ZERO,
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            UFixed6Lib.ZERO
        );
    }

    function store(GuaranteeStorageGlobal storage self, Guarantee memory newValue) internal {
        GuaranteeStorageLib.validate(newValue);

        uint256 encoded0 =
            uint256(newValue.orders << (256 - 32)) >> (256 - 32) |
            uint256(UFixed6.unwrap(newValue.takerFee) << (256 - 64)) >> (256 - 32 - 64);

        uint256 encode1 =
            uint256(UFixed6.unwrap(newValue.longPos) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.longNeg) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortPos) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortNeg) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encode1)
        }
    }
}

/// @dev Manually encodes and decodes the local Guarantee struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredGuaranteeLocal {
///         /* slot 0 */
///         uint32 orders;
///         int64 notional;
///         uint64 takerFee;
///         uint64 referral;
///
///         /* slot 1 */
///         uint64 longPos;
///         uint64 longNeg;
///         uint64 shortPos;
///         uint64 shortNeg;
///     }
///
library GuaranteeStorageLocalLib {
    function read(GuaranteeStorageLocal storage self) internal view returns (Guarantee memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return Guarantee(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 64 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(GuaranteeStorageLocal storage self, Guarantee memory newValue) internal {
        GuaranteeStorageLib.validate(newValue);

        if (newValue.notional.gt(Fixed6.wrap(type(int64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.notional.lt(Fixed6.wrap(type(int64).min))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.referral.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.orders << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.notional) << (256 - 64)) >> (256 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.takerFee) << (256 - 64)) >> (256 - 32 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.referral) << (256 - 64)) >> (256 - 32 - 64 - 64 - 64);
        uint256 encode1 =
            uint256(UFixed6.unwrap(newValue.longPos) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.longNeg) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortPos) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortNeg) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encode1)
        }
    }
}

library GuaranteeStorageLib {
    // sig: 0xfd030f36
    error GuaranteeStorageInvalidError();

    function validate(Guarantee memory newValue) internal pure {
        if (newValue.orders > type(uint32).max) revert GuaranteeStorageInvalidError();
        if (newValue.longPos.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.longNeg.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.shortPos.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.shortNeg.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
        if (newValue.takerFee.gt(UFixed6.wrap(type(uint64).max))) revert GuaranteeStorageLib.GuaranteeStorageInvalidError();
    }
}