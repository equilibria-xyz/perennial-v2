// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { OracleVersion } from "./OracleVersion.sol";
import { Position } from "./Position.sol";
import { Guarantee } from "./Guarantee.sol";
import { MarketParameter } from "./MarketParameter.sol";

/// @dev Order type
struct Order {
    /// @dev The timestamp of the order
    uint256 timestamp;

    /// @dev The quantity of orders that are included in this order
    uint256 orders;

    /// @dev The change in the collateral
    Fixed6 collateral;

    /// @dev The positive skew maker order size
    UFixed6 makerPos;

    /// @dev The negative skew maker order size
    UFixed6 makerNeg;

    /// @dev The positive skew long order size
    UFixed6 longPos;

    /// @dev The negative skew long order size
    UFixed6 longNeg;

    /// @dev The positive skew short order size
    UFixed6 shortPos;

    /// @dev The negative skew short order size
    UFixed6 shortNeg;

    /// @dev The protection status semaphore (local only)
    ///      (0 = no protection, 1+ = protected)
    uint256 protection;

    /// @dev The invalidation status semaphore (local only)
    ///      (0 = no invalidation possible / intent only, 1+ = partially or fully invalidatable)
    uint256 invalidation;

    /// @dev The referral fee multiplied by the size applicable to the referral
    UFixed6 makerReferral;

    /// @dev The referral fee multiplied by the size applicable to the referral
    UFixed6 takerReferral;
}
using OrderLib for Order global;
struct OrderStorageGlobal { uint256 slot0; uint256 slot1; uint256 slot2; } // SECURITY: must remain at (3) slots
using OrderStorageGlobalLib for OrderStorageGlobal global;
struct OrderStorageLocal { uint256 slot0; uint256 slot1; uint256 slot2; }
using OrderStorageLocalLib for OrderStorageLocal global;

/// @title Order
/// @dev (external-unsafe): this library must be used internally only
/// @notice Holds the state for an account's update order
library OrderLib {
    /// @notice Returns whether the order is ready to be settled
    /// @param self The order object to check
    /// @param latestVersion The latest oracle version
    /// @return Whether the order is ready to be settled
    function ready(Order memory self, OracleVersion memory latestVersion) internal pure returns (bool) {
        return latestVersion.timestamp >= self.timestamp;
    }

    /// @notice Prepares a fresh order with the current timestamp
    /// @param timestamp The current timestamp
    function fresh(uint256 timestamp) internal pure returns (Order memory newOrder) {
        newOrder.timestamp = timestamp;
    }

    /// @notice Invalidates the non-guarantee portion of the order
    /// @param self The order object to update
    /// @param guarantee The guarantee to keep from invalidating
    function invalidate(Order memory self, Guarantee memory guarantee) internal pure {
        (self.makerReferral, self.takerReferral) =
            (UFixed6Lib.ZERO, guarantee.orderReferral);
        (self.makerPos, self.makerNeg, self.longPos, self.longNeg, self.shortPos, self.shortNeg) =
            (UFixed6Lib.ZERO, UFixed6Lib.ZERO, guarantee.longPos, guarantee.longNeg, guarantee.shortPos, guarantee.shortNeg);
    }

    /// @notice Creates a new order from an intent order request or market update message
    /// @param timestamp The current timestamp
    /// @param position The current position
    /// @param makerAmount The magnitude and direction of maker position
    /// @param takerAmount The magnitude and direction of taker position
    /// @param collateral The change in the collateral
    /// @param referralFee The referral fee
    /// @return newOrder The resulting order
    function from(
        uint256 timestamp,
        Position memory position,
        Fixed6 makerAmount,
        Fixed6 takerAmount,
        Fixed6 collateral,
        bool protect,
        bool invalidatable,
        UFixed6 referralFee
    ) internal pure returns (Order memory newOrder) {
        UFixed6 newMaker = UFixed6Lib.from(Fixed6Lib.from(position.maker).add(makerAmount));
        Fixed6 newTaker = position.skew().add(takerAmount);

        return from(
            timestamp,
            position,
            collateral,
            newMaker,
            newTaker.max(Fixed6Lib.ZERO).abs(),
            newTaker.min(Fixed6Lib.ZERO).abs(),
            protect,
            invalidatable,
            referralFee
        );
    }

    /// @notice Creates a new order from the current position and an update request
    /// @param timestamp The current timestamp
    /// @param position The current position
    /// @param collateral The change in the collateral
    /// @param newMaker The new maker
    /// @param newLong The new long
    /// @param newShort The new short
    /// @param protect Whether to protect the order
    /// @param referralFee The referral fee
    /// @return newOrder The resulting order
    function from(
        uint256 timestamp,
        Position memory position,
        Fixed6 collateral,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        bool protect,
        bool invalidatable,
        UFixed6 referralFee
    ) internal pure returns (Order memory newOrder) {
        // compute side-based deltas from the current position and new position
        (Fixed6 makerAmount, Fixed6 longAmount, Fixed6 shortAmount) = (
            _change(position.maker, newMaker),
            _change(position.long, newLong),
            _change(position.short, newShort)
        );

        // populate the new order
        newOrder.timestamp = timestamp;
        newOrder.collateral = collateral;
        newOrder.makerPos = _positiveComponent(makerAmount);
        newOrder.makerNeg = _negativeComponent(makerAmount);
        newOrder.longPos = _positiveComponent(longAmount);
        newOrder.longNeg = _negativeComponent(longAmount);
        newOrder.shortPos = _positiveComponent(shortAmount);
        newOrder.shortNeg = _negativeComponent(shortAmount);
        newOrder.makerReferral = makerAmount.abs().mul(referralFee);
        newOrder.takerReferral = longAmount.abs().add(shortAmount.abs()).mul(referralFee);

        // set the order and invalidation counts
        if (protect) newOrder.protection = 1;
        if (!isEmpty(newOrder)) {
            newOrder.orders = 1;
            if (invalidatable) newOrder.invalidation = 1;
        }
    }

    /// @dev Helper function to compute the signed change between two unsigned values
    function _change(UFixed6 fromValue, UFixed6 toValue) internal pure returns (Fixed6) {
        return Fixed6Lib.from(toValue).sub(Fixed6Lib.from(fromValue));
    }

    /// @dev Helper function to compute the negative component of a signed value
    function _negativeComponent(Fixed6 value) internal pure returns (UFixed6) {
        return value.min(Fixed6Lib.ZERO).abs();
    }

    /// @dev Helper function to compute the positive component of a signed value
    function _positiveComponent(Fixed6 value) internal pure returns (UFixed6) {
        return value.max(Fixed6Lib.ZERO).abs();
    }

    /// @notice Returns whether the order increases any of the account's positions
    /// @return Whether the order increases any of the account's positions
    function increasesPosition(Order memory self) internal pure returns (bool) {
        return increasesMaker(self) || increasesTaker(self);
    }

    /// @notice Returns whether the order increases the account's long or short positions
    /// @return Whether the order increases the account's long or short positions
    function increasesTaker(Order memory self) internal pure returns (bool) {
        return !self.longPos.isZero() || !self.shortPos.isZero();
    }

    /// @notice Returns whether the order increases the account's maker position
    /// @return Whether the order increases the account's maker positions
    function increasesMaker(Order memory self) internal pure returns (bool) {
        return !self.makerPos.isZero();
    }

    /// @notice Returns whether the order decreases the liquidity of the market
    /// @return Whether the order decreases the liquidity of the market
    function decreasesLiquidity(Order memory self, Position memory currentPosition) internal pure returns (bool) {
        Fixed6 currentSkew = currentPosition.skew();
        Fixed6 latestSkew = currentSkew.sub(long(self)).add(short(self));
        return !self.makerNeg.isZero() || currentSkew.abs().gt(latestSkew.abs());
    }

    /// @notice Returns whether the order decreases the efficieny of the market
    /// @dev Decreased efficiency ratio intuitively means that the market is "more efficient" on an OI to LP basis.
    /// @return Whether the order decreases the liquidity of the market
    function decreasesEfficiency(Order memory self, Position memory currentPosition) internal pure returns (bool) {
        UFixed6 currentMajor = currentPosition.major();
        UFixed6 latestMajor = UFixed6Lib.from(Fixed6Lib.from(currentPosition.long).sub(long(self)))
            .max(UFixed6Lib.from(Fixed6Lib.from(currentPosition.short).sub(short(self))));
        return !self.makerNeg.isZero() || currentMajor.gt(latestMajor);
    }

    /// @notice Returns whether the order crosses zero (has delta on both the long and short sides)
    /// @param self The Order object to check
    /// @return Whether the order crosses zero
    function crossesZero(Order memory self) internal pure returns (bool) {
        return !self.longPos.add(self.longNeg).isZero() && !self.shortPos.add(self.shortNeg).isZero();
    }

    /// @notice Returns whether the order is applicable for liquidity checks
    /// @param self The Order object to check
    /// @param marketParameter The market parameter
    /// @return Whether the order is applicable for liquidity checks
    function liquidityCheckApplicable(
        Order memory self,
        MarketParameter memory marketParameter
    ) internal pure returns (bool) {
        return !marketParameter.closed &&
        // not "a taker order that is increasing" ->
        // not (any of the following)
        //  - taker is empty (not a taker order)
        //  - taker is increasing (position going more long or short)
            ((long(self).isZero() && short(self).isZero()) || increasesTaker(self));
    }

    /// @notice Returns the maker fee for the order
    /// @param self The order object to check
    /// @param oracleVersion The settlement oracle version
    /// @param marketParameter The market parameter
    /// @return The maker fee
    function makerFee(
        Order memory self,
        OracleVersion memory oracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6) {
        return self.makerTotal()
            .mul(oracleVersion.price.abs())
            .mul(marketParameter.makerFee);
    }

    /// @notice Returns the taker fee for the order
    /// @param self The order object to check
    /// @param guarantee The guarantee
    /// @param oracleVersion The settlement oracle version
    /// @param marketParameter The market parameter
    /// @return The taker fee
    function takerFee(
        Order memory self,
        Guarantee memory guarantee,
        OracleVersion memory oracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6) {
        return self.takerTotal().sub(guarantee.takerFee)
            .mul(oracleVersion.price.abs())
            .mul(marketParameter.takerFee);
    }

    /// @notice Returns whether the order is protected
    /// @param self The order object to check
    /// @return Whether the order is protected
    function protected(Order memory self) internal pure returns (bool) {
        return self.protection != 0;
    }

    /// @notice Returns whether the order is empty
    /// @param self The order object to check
    /// @return Whether the order is empty
    function isEmpty(Order memory self) internal pure returns (bool) {
        return makerTotal(self).isZero() && takerTotal(self).isZero();
    }

    /// @notice Returns the maker delta of the order
    /// @param self The order object to check
    /// @return The maker delta of the order
    function maker(Order memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.makerPos).sub(Fixed6Lib.from(self.makerNeg));
    }

    /// @notice Returns the long delta of the order
    /// @param self The order object to check
    /// @return The long delta of the order
    function long(Order memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.longPos).sub(Fixed6Lib.from(self.longNeg));
    }

    /// @notice Returns the short delta of the order
    /// @param self The order object to check
    /// @return The short delta of the order
    function short(Order memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.shortPos).sub(Fixed6Lib.from(self.shortNeg));
    }

    /// @notice Returns the positive taker delta of the order
    /// @param self The order object to check
    /// @return The positive taker delta of the order
    function takerPos(Order memory self) internal pure returns (UFixed6) {
        return self.longPos.add(self.shortNeg);
    }

    /// @notice Returns the negative taker delta of the order
    /// @param self The order object to check
    /// @return The negative taker delta of the order
    function takerNeg(Order memory self) internal pure returns (UFixed6) {
        return self.shortPos.add(self.longNeg);
    }

    /// @notice Returns the total maker delta of the order
    /// @param self The order object to check
    /// @return The total maker delta of the order
    function makerTotal(Order memory self) internal pure returns (UFixed6) {
        return self.makerPos.add(self.makerNeg);
    }

    /// @notice Returns the total taker delta of the order
    /// @param self The order object to check
    /// @return The total taker delta of the order
    function takerTotal(Order memory self) internal pure returns (UFixed6) {
        return self.takerPos().add(self.takerNeg());
    }

    /// @notice Returns the positive delta of the order
    /// @param self The order object to check
    /// @return The positive delta of the order
    function pos(Order memory self) internal pure returns (UFixed6) {
        return self.makerPos.add(self.longPos).add(self.shortPos);
    }

    /// @notice Returns the positive delta of the order
    /// @param self The order object to check
    /// @return The positive delta of the order
    function neg(Order memory self) internal pure returns (UFixed6) {
        return self.makerNeg.add(self.longNeg).add(self.shortNeg);
    }

    /// @notice Updates the current global order with a new local order
    /// @param self The order object to update
    /// @param order The new order
    function add(Order memory self, Order memory order) internal pure {
        (self.orders, self.collateral, self.protection, self.invalidation, self.makerReferral, self.takerReferral) = (
            self.orders + order.orders,
            self.collateral.add(order.collateral),
            self.protection + order.protection,
            self.invalidation + order.invalidation,
            self.makerReferral.add(order.makerReferral),
            self.takerReferral.add(order.takerReferral)
        );

        (self.makerPos, self.makerNeg, self.longPos, self.longNeg, self.shortPos, self.shortNeg) = (
            self.makerPos.add(order.makerPos),
            self.makerNeg.add(order.makerNeg),
            self.longPos.add(order.longPos),
            self.longNeg.add(order.longNeg),
            self.shortPos.add(order.shortPos),
            self.shortNeg.add(order.shortNeg)
        );
    }

    /// @notice Subtracts the latest local order from current global order
    /// @param self The order object to update
    /// @param order The latest order
    function sub(Order memory self, Order memory order) internal pure {
        (self.orders, self.collateral, self.protection, self.invalidation, self.makerReferral, self.takerReferral) = (
            self.orders - order.orders,
            self.collateral.sub(order.collateral),
            self.protection - order.protection,
            self.invalidation - order.invalidation,
            self.makerReferral.sub(order.makerReferral),
            self.takerReferral.sub(order.takerReferral)
        );

        (self.makerPos, self.makerNeg, self.longPos, self.longNeg, self.shortPos, self.shortNeg) = (
            self.makerPos.sub(order.makerPos),
            self.makerNeg.sub(order.makerNeg),
            self.longPos.sub(order.longPos),
            self.longNeg.sub(order.longNeg),
            self.shortPos.sub(order.shortPos),
            self.shortNeg.sub(order.shortNeg)
        );
    }
}

/// @dev Manually encodes and decodes the global Order struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredOrderGlobal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint32 orders;
///         int64 collateral;
///         uint64 makerPos;
///         uint64 makerNeg;
///
///         /* slot 1 */
///         uint64 longPos;
///         uint64 longNeg;
///         uint64 shortPos;
///         uint64 shortNeg;
///
///         /* slot 2 */
///         uint64 takerReferral;
///         uint64 makerReferral;
///     }
///
library OrderStorageGlobalLib {
    function read(OrderStorageGlobal storage self) internal view returns (Order memory) {
        (uint256 slot0, uint256 slot1, uint256 slot2) = (self.slot0, self.slot1, self.slot2);

        return Order(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64 - 64)) >> (256 - 64)),
            0,
            0,
            UFixed6.wrap(uint256(slot2 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot2 << (256 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(OrderStorageGlobal storage self, Order memory newValue) external {
        OrderStorageLib.validate(newValue);

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(newValue.orders << (256 - 32)) >> (256 - 32 - 32) |
            uint256(Fixed6.unwrap(newValue.collateral) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.makerPos) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.makerNeg) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64 - 64);
        uint256 encoded1 =
            uint256(UFixed6.unwrap(newValue.longPos) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.longNeg) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortPos) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortNeg) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);
        uint256 encoded2 =
            uint256(UFixed6.unwrap(newValue.makerReferral) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.takerReferral) << (256 - 64)) >> (256 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
            sstore(add(self.slot, 2), encoded2)
        }
    }
}

/// @dev Manually encodes and decodes the local Order struct into storage.
///
///     struct StoredOrderLocal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint32 orders;
///         int64 collateral;
///         uint64 makerPos;
///         uint64 makerNeg;
///
///         /* slot 1 */
///         uint64 longPos;
///         uint64 longNeg;
///         uint64 shortPos;
///         uint64 shortNeg;
///
///         /* slot 2 */
///         uint64 takerReferral;
///         uint64 makerReferral;
///         uint1 protection;
///         uint8 invalidation;
///     }
///
library OrderStorageLocalLib {
    function read(OrderStorageLocal storage self) internal view returns (Order memory) {
        (uint256 slot0, uint256 slot1, uint256 slot2) = (self.slot0, self.slot1, self.slot2);

        return Order(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64 - 64 - 64)) >> (256 - 64)),
            uint256(slot2 << (256 - 64 - 64 - 1)) >> (256 - 1),
            uint256(slot2 << (256 - 64 - 64 - 1 - 8)) >> (256 - 8),
            UFixed6.wrap(uint256(slot2 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot2 << (256 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(OrderStorageLocal storage self, Order memory newValue) external {
        OrderStorageLib.validate(newValue);

        if (newValue.protection > 1) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.invalidation > type(uint8).max) revert OrderStorageLib.OrderStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(newValue.orders << (256 - 32)) >> (256 - 32 - 32) |
            uint256(Fixed6.unwrap(newValue.collateral) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.makerPos) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.makerNeg) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64 - 64);
        uint256 encoded1 =
            uint256(UFixed6.unwrap(newValue.longPos) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.longNeg) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortPos) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.shortNeg) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);
        uint256 encoded2 =
            uint256(UFixed6.unwrap(newValue.makerReferral) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.takerReferral) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(newValue.protection << (256 - 1)) >> (256 - 64 - 64 - 1) |
            uint256(newValue.invalidation << (256 - 8)) >> (256 - 64 - 64 - 1 - 8);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
            sstore(add(self.slot, 2), encoded2)
        }
    }
}

library OrderStorageLib {
    // sig: 0x67e45965
    error OrderStorageInvalidError();

    function validate(Order memory newValue) internal pure {
        if (newValue.timestamp > type(uint32).max) revert OrderStorageInvalidError();
        if (newValue.orders > type(uint32).max) revert OrderStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert OrderStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert OrderStorageInvalidError();
        if (newValue.makerReferral.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageInvalidError();
        if (newValue.takerReferral.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageInvalidError();
        if (newValue.makerPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.makerNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.longPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.longNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.shortPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.shortNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
    }
}