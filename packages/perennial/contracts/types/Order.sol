// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Local.sol";
import "./Position.sol";
import "./MarketParameter.sol";

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

    /// @dev The protection status semaphore
    uint256 protection;

    /// @dev The referral fee
    UFixed6 makerReferral;

    /// @dev The referral fee
    UFixed6 takerReferral;
}
using OrderLib for Order global;
struct OrderStorageGlobal { uint256 slot0; uint256 slot1; uint256 slot2; } // SECURITY: must remain at (3) slots
using OrderStorageGlobalLib for OrderStorageGlobal global;
struct OrderStorageLocal { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using OrderStorageLocalLib for OrderStorageLocal global;

/// @title Order
/// @notice Holds the state for an account's update order
library OrderLib {
    /// @notice Returns whether the order is ready to be settled
    /// @param self The order object to check
    /// @param latestVersion The latest oracle version
    /// @return Whether the order is ready to be settled
    function ready(Order memory self, OracleVersion memory latestVersion) internal pure returns (bool) {
        return latestVersion.timestamp >= self.timestamp;
    }

    /// @notice Prepares the next order from the current order
    /// @param self The order object to update
    /// @param timestamp The current timestamp
    function next(Order memory self, uint256 timestamp) internal pure  {
        invalidate(self);
        (self.timestamp, self.orders, self.collateral, self.protection) = (timestamp, 0, Fixed6Lib.ZERO, 0);
    }

    /// @notice Invalidates the order
    /// @param self The order object to update
    function invalidate(Order memory self) internal pure {
        (self.makerReferral, self.takerReferral) =
            (UFixed6Lib.ZERO, UFixed6Lib.ZERO);
        (self.makerPos, self.makerNeg, self.longPos, self.longNeg, self.shortPos, self.shortNeg) =
            (UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO, UFixed6Lib.ZERO);
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
        UFixed6 referralFee
    ) internal pure returns (Order memory newOrder) {
        (Fixed6 makerAmount, Fixed6 longAmount, Fixed6 shortAmount) = (
            Fixed6Lib.from(newMaker).sub(Fixed6Lib.from(position.maker)),
            Fixed6Lib.from(newLong).sub(Fixed6Lib.from(position.long)),
            Fixed6Lib.from(newShort).sub(Fixed6Lib.from(position.short))
        );

        UFixed6 referral = makerAmount.abs().add(longAmount.abs()).add(shortAmount.abs()).mul(referralFee);

        newOrder = Order(
            timestamp,
            0,
            collateral,
            makerAmount.max(Fixed6Lib.ZERO).abs(),
            makerAmount.min(Fixed6Lib.ZERO).abs(),
            longAmount.max(Fixed6Lib.ZERO).abs(),
            longAmount.min(Fixed6Lib.ZERO).abs(),
            shortAmount.max(Fixed6Lib.ZERO).abs(),
            shortAmount.min(Fixed6Lib.ZERO).abs(),
            protect ? 1 : 0,
            makerAmount.isZero() ? UFixed6Lib.ZERO : referral,
            makerAmount.isZero() ? referral : UFixed6Lib.ZERO
        );
        if (!isEmpty(newOrder)) newOrder.orders = 1;
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

    /// @notice Returns whether the order is applicable for liquidity checks
    /// @param self The Order object to check
    /// @param marketParameter The market parameter
    /// @return Whether the order is applicable for liquidity checks
    function liquidityCheckApplicable(
        Order memory self,
        MarketParameter memory marketParameter
    ) internal pure returns (bool) {
        return !marketParameter.closed &&
            ((maker(self).isZero()) || !marketParameter.makerCloseAlways || increasesMaker(self)) &&
            ((long(self).isZero() && short(self).isZero()) || !marketParameter.takerCloseAlways || increasesTaker(self));
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
        return pos(self).isZero() && neg(self).isZero();
    }

     /// @notice Returns the direction of the order
    /// @dev 0 = maker, 1 = long, 2 = short
    /// @param self The position object to check
    /// @return The direction of the position
    function direction(Order memory self) internal pure returns (uint256) {
        if (!self.longPos.isZero() || !self.longNeg.isZero()) return 1;
        if (!self.shortPos.isZero() || !self.shortNeg.isZero()) return 2;

        return 0;
    }

    /// @notice Returns the magnitude of the order
    /// @param self The order object to check
    /// @return The magnitude of the order
    function magnitude(Order memory self) internal pure returns (Fixed6) {
        return maker(self).add(long(self)).add(short(self));
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
        (self.orders, self.collateral, self.protection, self.makerReferral, self.takerReferral) = (
            self.orders + order.orders,
            self.collateral.add(order.collateral),
            self.protection + order.protection,
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
        (self.orders, self.collateral, self.protection, self.makerReferral, self.takerReferral) = (
            self.orders - order.orders,
            self.collateral.sub(order.collateral),
            self.protection - order.protection,
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
            UFixed6.wrap(uint256(slot2 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot2 << (256 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(OrderStorageGlobal storage self, Order memory newValue) internal {
        OrderStorageLib.validate(newValue);

        if (newValue.makerPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.makerNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.longPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.longNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.shortPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.shortNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageLib.OrderStorageInvalidError();

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
///         uint2 direction;
///         uint62 magnitudePos;
///         uint62 magnitudeNeg;
///         uint1 protection;
///
///         /* slot 1 */
///         uint64 takerReferral;
///         uint64 makerReferral;
///     }
///
library OrderStorageLocalLib {
    function read(OrderStorageLocal storage self) internal view returns (Order memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);

        uint256 direction = uint256(slot0 << (256 - 32 - 32 - 64 - 2)) >> (256 - 2);
        UFixed6 magnitudePos = UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 2 - 62)) >> (256 - 62));
        UFixed6 magnitudeNeg = UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 2 - 62 - 62)) >> (256 - 62));

        return Order(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            uint256(slot0 << (256 - 32 - 32)) >> (256 - 32),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            direction == 0 ? magnitudePos : UFixed6Lib.ZERO,
            direction == 0 ? magnitudeNeg : UFixed6Lib.ZERO,
            direction == 1 ? magnitudePos : UFixed6Lib.ZERO,
            direction == 1 ? magnitudeNeg : UFixed6Lib.ZERO,
            direction == 2 ? magnitudePos : UFixed6Lib.ZERO,
            direction == 2 ? magnitudeNeg : UFixed6Lib.ZERO,
            uint256(slot0 << (256 - 32 - 32 - 64 - 2 - 62 - 62 - 1)) >> (256 - 1),
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(OrderStorageLocal storage self, Order memory newValue) internal {
        OrderStorageLib.validate(newValue);

        (UFixed6 magnitudePos, UFixed6 magnitudeNeg) = (newValue.pos(), newValue.neg());

        if (magnitudePos.gt(UFixed6.wrap(2 ** 62 - 1))) revert OrderStorageLib.OrderStorageInvalidError();
        if (magnitudeNeg.gt(UFixed6.wrap(2 ** 62 - 1))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.protection > 1) revert OrderStorageLib.OrderStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(newValue.orders << (256 - 32)) >> (256 - 32 - 32) |
            uint256(Fixed6.unwrap(newValue.collateral) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(newValue.direction() << (256 - 2)) >> (256 - 32 - 32 - 64 - 2) |
            uint256(UFixed6.unwrap(magnitudePos) << (256 - 62)) >> (256 - 32 - 32 - 64 - 2 - 62) |
            uint256(UFixed6.unwrap(magnitudeNeg) << (256 - 62)) >> (256 - 32 - 32 - 64 - 2 - 62 - 62) |
            uint256(newValue.protection << (256 - 1)) >> (256 - 32 - 32 - 64 - 2 - 62 - 62 - 1);
        uint256 encoded1 =
            uint256(UFixed6.unwrap(newValue.makerReferral) << (256 - 64)) >> (256 - 64) |
            uint256(UFixed6.unwrap(newValue.takerReferral) << (256 - 64)) >> (256 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
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
    }
}