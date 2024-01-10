// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Global.sol";
import "./Local.sol";
import "./Invalidation.sol";

/// @dev Order type
struct Order {
    /// @dev The timestamp of the order
    uint256 timestamp;

    /// @dev The quantity of orders that are included in this order
    uint256 orders;

    /// @dev@dev The change in the maker position
    Fixed6 maker;

    /// @dev @dev The change in the long position
    Fixed6 long;

    /// @dev @dev The change in the short position
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
using OrderLib for Order global;
struct OrderStorageGlobal { uint256 slot0; uint256 slot1; }
using OrderStorageGlobalLib for OrderStorageGlobal global;
struct OrderStorageLocal { uint256 slot0; }
using OrderStorageLocalLib for OrderStorageLocal global;

/// @title Order
/// @notice Holds the state for an account's update order
library OrderLib {
    /// @notice Helper to create a new order from basic data
    /// @param timestamp The timestamp of the order
    /// @param orders The quantity of orders that are included in this order
    /// @param maker The change in the maker position
    /// @param long The change in the long position
    /// @param short The change in the short position
    /// @return The new order
    function from(
        uint256 timestamp,
        uint256 orders,
        Fixed6 maker,
        Fixed6 long,
        Fixed6 short
    ) internal pure returns (Order memory) {
        return Order(
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

    /// @notice Creates a new order from the current position and an update request
    /// @param timestamp The current timestamp
    /// @param position The current position
    /// @param newMaker The new maker
    /// @param newLong The new long
    /// @param newShort The new short
    /// @return newOrder The resulting order
    function from(
        uint256 timestamp,
        Position memory position,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort
    ) internal pure returns (Order memory newOrder) {
        newOrder = from(
            timestamp,
            0,
            Fixed6Lib.from(newMaker).sub(Fixed6Lib.from(position.maker)),
            Fixed6Lib.from(newLong).sub(Fixed6Lib.from(position.long)),
            Fixed6Lib.from(newShort).sub(Fixed6Lib.from(position.short))
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
        return self.long.gt(Fixed6Lib.ZERO) || self.short.gt(Fixed6Lib.ZERO);
    }

    /// @notice Returns whether the order increases the account's maker position
    /// @return Whether the order increases the account's maker positions
    function increasesMaker(Order memory self) internal pure returns (bool) {
        return self.maker.gt(Fixed6Lib.ZERO);
    }

    /// @notice Returns whether the order decreases the liquidity of the market
    /// @return Whether the order decreases the liquidity of the market
    function decreasesLiquidity(Order memory self, Position memory currentPosition) internal pure returns (bool) {
        Fixed6 currentSkew = currentPosition.skew();
        Fixed6 latestSkew = currentSkew.sub(self.long).add(self.short);
        return self.maker.lt(Fixed6Lib.ZERO) || currentSkew.abs().gt(latestSkew.abs());
    }

    /// @notice Returns whether the order decreases the efficieny of the market
    /// @dev Decreased efficiency ratio intuitively means that the market is "more efficient" on an OI to LP basis.
    /// @return Whether the order decreases the liquidity of the market
    function decreasesEfficiency(Order memory self, Position memory currentPosition) internal pure returns (bool) {
        UFixed6 currentMajor = currentPosition.major();
        UFixed6 latestMajor = UFixed6Lib.from(Fixed6Lib.from(currentPosition.long).sub(self.long))
            .max(UFixed6Lib.from(Fixed6Lib.from(currentPosition.short).sub(self.short)));
        return self.maker.lt(Fixed6Lib.ZERO) || currentMajor.gt(latestMajor);
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
            ((self.maker.isZero()) || !marketParameter.makerCloseAlways || increasesMaker(self)) &&
            ((self.long.isZero() && self.short.isZero()) || !marketParameter.takerCloseAlways || increasesTaker(self));
    }

    /// @notice Returns the liquidation fee of the position
    /// @dev Assumes the order must be single-sided
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @return The liquidation fee of the position
    function liquidationFee(
        Order memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) internal pure returns (UFixed6) {
        if (isEmpty(self)) return UFixed6Lib.ZERO;

        UFixed6 partialMaintenance = magnitude(self).abs()
            .mul(latestVersion.price.abs())
            .mul(riskParameter.maintenance)
            .max(riskParameter.minMaintenance);

        return partialMaintenance.mul(riskParameter.liquidationFee)
            .min(riskParameter.maxLiquidationFee)
            .max(riskParameter.minLiquidationFee);
    }

    /// @notice Returns whether the order is empty
    /// @param self The order object to check
    /// @return Whether the order is empty
    function isEmpty(Order memory self) internal pure returns (bool) {
        return magnitude(self).isZero();
    }

     /// @notice Returns the direction of the order
    /// @dev 0 = maker, 1 = long, 2 = short
    /// @param self The position object to check
    /// @return The direction of the position
    function direction(Order memory self) internal pure returns (uint256) {
        return self.long.isZero() ? (self.short.isZero() ? 0 : 2) : 1;
    }

    /// @notice Returns the magnitude of the order
    /// @param self The order object to check
    /// @return The magnitude of the order
    function magnitude(Order memory self) internal pure returns (Fixed6) {
        return self.maker.add(self.long).add(self.short);
    }

    /// @notice Updates the current global order with a new local order
    /// @param self The order object to update
    /// @param order The new order
    function add(Order memory self, Order memory order) internal pure {
        (self.timestamp, self.maker, self.long, self.short) = (
            order.timestamp,
            self.maker.add(order.maker),
            self.long.add(order.long),
            self.short.add(order.short)
        );

        (self.orders, self.makerPos, self.makerNeg, self.takerPos, self.takerNeg) = (
            self.orders + order.orders,
            self.makerPos.add(order.makerPos),
            self.makerNeg.add(order.makerNeg),
            self.takerPos.add(order.takerPos),
            self.takerNeg.add(order.takerNeg)
        );
    }
}

/// @dev Manually encodes and decodes the global Order struct into storage.
///
///     struct StoredOrderGlobal {
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
library OrderStorageGlobalLib {
    function read(OrderStorageGlobal storage self) internal view returns (Order memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);

        UFixed6 makerPos = UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64));
        UFixed6 makerNeg = UFixed6.wrap(uint256(slot1 << (256 - 64 - 64)) >> (256 - 64));

        return Order(
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

    function store(OrderStorageGlobal storage self, Order memory newValue) internal {
        OrderStorageLib.validate(newValue);

        if (newValue.maker.gt(Fixed6.wrap(type(int64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.maker.lt(Fixed6.wrap(type(int64).min))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.long.gt(Fixed6.wrap(type(int64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.long.lt(Fixed6.wrap(type(int64).min))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.short.gt(Fixed6.wrap(type(int64).max))) revert OrderStorageLib.OrderStorageInvalidError();
        if (newValue.short.lt(Fixed6.wrap(type(int64).min))) revert OrderStorageLib.OrderStorageInvalidError();

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

/// @dev Manually encodes and decodes the local Order struct into storage.
///
///     struct StoredOrderLocal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint2 direction;
///         int62 magnitude;
///     }
///
library OrderStorageLocalLib {
    function read(OrderStorageLocal storage self) internal view returns (Order memory) {
        uint256 slot0 = self.slot0;

        uint256 direction = uint256(slot0 << (256 - 2)) >> (256 - 2);
        Fixed6 magnitude = Fixed6.wrap(int256(slot0 << (256 - 2 - 62)) >> (256 - 62));

        return OrderLib.from(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            magnitude.isZero() ? 0 : 1,
            direction == 0 ? magnitude : Fixed6Lib.ZERO,
            direction == 1 ? magnitude : Fixed6Lib.ZERO,
            direction == 2 ? magnitude : Fixed6Lib.ZERO
        );
    }

    function store(OrderStorageLocal storage self, Order memory newValue) internal {
        OrderStorageLib.validate(newValue);

        Fixed6 magnitude = newValue.magnitude();

        if (magnitude.gt(Fixed6.wrap(2 ** 61 - 1))) revert OrderStorageLib.OrderStorageInvalidError();

        uint256 encoded =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(newValue.direction() << (256 - 2)) >> (256 - 32 - 2) |
            uint256(Fixed6.unwrap(magnitude) << (256 - 62)) >> (256 - 32 - 2 - 62);

        assembly {
            sstore(self.slot, encoded)
        }
    }
}

library OrderStorageLib {
    // sig: 0x67e45965
    error OrderStorageInvalidError();

    function validate(Order memory newValue) internal pure {
        if (newValue.timestamp > type(uint32).max) revert OrderStorageInvalidError();
        if (newValue.orders > type(uint32).max) revert OrderStorageInvalidError();
        if (newValue.makerPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageInvalidError();
        if (newValue.makerNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageInvalidError();
        if (newValue.takerPos.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageInvalidError();
        if (newValue.takerNeg.gt(UFixed6.wrap(type(uint64).max))) revert OrderStorageInvalidError();
    }
}