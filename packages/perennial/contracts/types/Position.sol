// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Order.sol";

/// @dev Order type
struct Position {
    /// @dev The position id (only used for non-pending positions)
    uint256 id; // TODO (gas hint): unused in the pending instances

    /// @dev The timestamp of the position
    uint256 timestamp;

    /// @dev The maker position size
    UFixed6 maker;

    /// @dev The long position size
    UFixed6 long;

    /// @dev The short position size
    UFixed6 short;

    /// @dev The fee for the position (only used for pending positions)
    UFixed6 fee; // TODO (gas hint): unused in the non-pending instances

    /// @dev The fixed settlement fee for the position (only used for pending positions)
    UFixed6 keeper; // TODO (gas hint): unused in the non-pending instances

    /// @dev The collateral at the time of the position settlement (only used for pending positions)
    Fixed6 collateral;

    /// @dev The change in collateral during this position (only used for pending positions)
    Fixed6 delta;
}
using PositionLib for Position global;
struct StoredPositionGlobal {
    uint32 _id;
    uint32 _timestamp;
    uint48 _maker;
    uint48 _long;
    uint48 _short;
    uint48 _fee;

    //TODO: pack better
    uint48 _keeper;
}
struct PositionStorageGlobal { StoredPositionGlobal value; }
using PositionStorageGlobalLib for PositionStorageGlobal global;
struct StoredPositionLocal {
    uint24 _id;
    uint32 _timestamp;
    uint8 _direction;
    uint48 _position;
    uint48 _fee;
    int48 _collateral;
    int48 _delta;

    // TODO: pack better
    uint48 _keeper;
}
struct PositionStorageLocal { StoredPositionLocal value; }
using PositionStorageLocalLib for PositionStorageLocal global;

/// @title Position
/// @notice Holds the state for a position
library PositionLib {
    /// @notice Returns whether the position is ready to be settled
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @return Whether the position is ready to be settled
    function ready(Position memory self, OracleVersion memory latestVersion) internal pure returns (bool) {
        return latestVersion.timestamp >= self.timestamp;
    }

    /// @notice Replaces the position with the new latest position
    /// @param self The position object to update
    /// @param newPosition The new latest position
    function update(Position memory self, Position memory newPosition) internal pure {
        (self.id, self.timestamp, self.maker, self.long, self.short) = (
            newPosition.id,
            newPosition.timestamp,
            newPosition.maker,
            newPosition.long,
            newPosition.short
        );
    }

    /// @notice Updates the current local position with a new order
    /// @param self The position object to update
    /// @param currentId The current position id
    /// @param currentTimestamp The current timestamp
    /// @param newMaker The new maker position
    /// @param newLong The new long position
    /// @param newShort The new short position
    /// @return newOrder The new order
    function update(
        Position memory self,
        uint256 currentId,
        uint256 currentTimestamp,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort
    ) internal pure returns (Order memory newOrder) {
        (newOrder.maker, newOrder.long, newOrder.short) = (
            Fixed6Lib.from(newMaker).sub(Fixed6Lib.from(self.maker)),
            Fixed6Lib.from(newLong).sub(Fixed6Lib.from(self.long)),
            Fixed6Lib.from(newShort).sub(Fixed6Lib.from(self.short))
        );

        if (self.id != currentId) _prepare(self);
        (self.id, self.timestamp, self.maker, self.long, self.short) =
            (currentId, currentTimestamp, newMaker, newLong, newShort);
    }

    /// @notice Updates the current global position with a new order
    /// @param self The position object to update
    /// @param currentId The current position id
    /// @param currentTimestamp The current timestamp
    /// @param order The new order
    /// @param riskParameter The current risk parameter
    function update(
        Position memory self,
        uint256 currentId,
        uint256 currentTimestamp,
        Order memory order,
        RiskParameter memory riskParameter
    ) internal pure {
        // load the computed attributes of the latest position
        Fixed6 latestSkew = virtualSkew(self, riskParameter);
        (order.net, order.efficiency, order.utilization) =
            (Fixed6Lib.from(net(self)), Fixed6Lib.from(efficiency(self)), Fixed6Lib.from(utilization(self)));

        // if the id is fresh, reset the position's applicable attributes
        if (self.id != currentId) _prepare(self);

        // update the position's attributes
        (self.id, self.timestamp, self.maker, self.long, self.short) = (
            currentId,
            currentTimestamp,
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(order.maker)),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(order.long)),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(order.short))
        );

        // TODO(cleanup): move to order
        // update the order's delta attributes with the positions updated attributes
        (order.net, order.skew, order.impact, order.efficiency, order.utilization) = (
            Fixed6Lib.from(net(self)).sub(order.net),
            virtualSkew(self, riskParameter).sub(latestSkew).abs(),
            Fixed6Lib.from(virtualSkew(self, riskParameter).abs()).sub(Fixed6Lib.from(latestSkew.abs())),
            Fixed6Lib.from(efficiency(self)).sub(order.efficiency),
            Fixed6Lib.from(utilization(self)).sub(order.utilization)
        );
    }

    /// @notice prepares the position for the next id
    /// @param self The position object to update
    function _prepare(Position memory self) private pure {
        self.fee = UFixed6Lib.ZERO;
        self.keeper = UFixed6Lib.ZERO;
        self.collateral = Fixed6Lib.ZERO;
    }

    /// @notice Updates the collateral delta of the position
    /// @param self The position object to update
    /// @param collateralAmount The amount of collateral change that occurred
    function update(Position memory self, Fixed6 collateralAmount) internal pure {
        self.delta = self.delta.add(collateralAmount);
    }

    /// @notice Processes an invalidation of the position
    /// @dev Replaces the maker, long, and short positions with the latest valid version's
    /// @param self The position object to update
    /// @param latestPosition The latest valid position
    function invalidate(Position memory self, Position memory latestPosition) internal pure {
        (self.maker, self.long, self.short, self.fee) = (
            latestPosition.maker,
            latestPosition.long,
            latestPosition.short,
            UFixed6Lib.ZERO
        );
    }

    /// @notice Processes a sync of the position
    /// @dev Moves the timestamp forward to the latest version's timestamp, while resetting the fee and keeper
    /// @param self The position object to update
    /// @param latestVersion The latest oracle version
    function sync(Position memory self, OracleVersion memory latestVersion) internal pure {
        (self.timestamp, self.fee, self.keeper) = (latestVersion.timestamp, UFixed6Lib.ZERO, UFixed6Lib.ZERO);
    }

    /// @notice Registers the fees from a new order
    /// @param self The position object to update
    /// @param order The new order
    function registerFee(Position memory self, Order memory order) internal pure {
        self.fee = self.fee.add(order.fee);
        self.keeper = self.keeper.add(order.keeper);
    }

    /// @notice Returns the maximum position size
    /// @param self The position object to check
    /// @return The maximum position size
    function magnitude(Position memory self) internal pure returns (UFixed6) {
        return self.long.max(self.short).max(self.maker);
    }

    /// @notice Returns the maximum taker position size
    /// @param self The position object to check
    /// @return The maximum taker position size
    function major(Position memory self) internal pure returns (UFixed6) {
        return self.long.max(self.short);
    }

    /// @notice Returns the minimum maker position size
    /// @param self The position object to check
    /// @return The minimum maker position size
    function minor(Position memory self) internal pure returns (UFixed6) {
        return self.long.min(self.short);
    }

    /// @notice Returns the difference between the long and short positions
    /// @param self The position object to check
    /// @return The difference between the long and short positions
    function net(Position memory self) internal pure returns (UFixed6) {
        return Fixed6Lib.from(self.long).sub(Fixed6Lib.from(self.short)).abs();
    }

    /// @notice Returns the skew of the position
    /// @dev skew = (long - short) / max(long, short)
    /// @param self The position object to check
    /// @return The skew of the position
    function skew(Position memory self) internal pure returns (Fixed6) {
        return _skew(self, UFixed6Lib.ZERO);
    }

    /// @notice Returns the skew of the position taking into account the virtual taker
    /// @dev virtual skew = (long - short) / (max(long, short) + virtualTaker)
    /// @param self The position object to check
    /// @param riskParameter The current risk parameter
    /// @return The virtual skew of the position
    function virtualSkew(Position memory self, RiskParameter memory riskParameter) internal pure returns (Fixed6) {
        return _skew(self, riskParameter.virtualTaker);
    }

    /// @notice Helper function to return the skew of the position with an optional virtual taker
    /// @param self The position object to check
    /// @param virtualTaker The virtual taker to use in the calculation
    /// @return The virtual skew of the position
    function _skew(Position memory self, UFixed6 virtualTaker) internal pure returns (Fixed6) {
        return major(self).isZero() ?
            Fixed6Lib.ZERO :
            Fixed6Lib.from(self.long)
                .sub(Fixed6Lib.from(self.short))
                .div(Fixed6Lib.from(major(self).add(virtualTaker)));
    }

    /// @notice Returns the utilization of the position
    /// @dev utilization = major / (maker + minor)
    /// @param self The position object to check
    /// @return The utilization of the position
    function utilization(Position memory self) internal pure returns (UFixed6) {
        return major(self).unsafeDiv(self.maker.add(minor(self))).min(UFixed6Lib.ONE);
    }

    /// @notice Returns the long position with socialization taken into account
    /// @param self The position object to check
    /// @return The long position with socialization taken into account
    function longSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.short).min(self.long);
    }

    /// @notice Returns the short position with socialization taken into account
    /// @param self The position object to check
    /// @return The short position with socialization taken into account
    function shortSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.long).min(self.short);
    }

    /// @notice Returns the major position with socialization taken into account
    /// @param self The position object to check
    /// @return The major position with socialization taken into account
    function takerSocialized(Position memory self) internal pure returns (UFixed6) {
        return major(self).min(minor(self).add(self.maker));
    }

    /// @notice Returns the efficiency of the position
    /// @dev efficiency = maker / major
    /// @param self The position object to check
    /// @return The efficiency of the position
    function efficiency(Position memory self) internal pure returns (UFixed6) {
        return self.maker.unsafeDiv(major(self)).min(UFixed6Lib.ONE);
    }

    /// @notice Returns the whether the position is socialized
    /// @param self The position object to check
    /// @return Whether the position is socialized
    function socialized(Position memory self) internal pure returns (bool) {
        return self.maker.add(self.short).lt(self.long) || self.maker.add(self.long).lt(self.short);
    }

    /// @notice Returns the whether the position is single-sided
    /// @param self The position object to check
    /// @return Whether the position is single-sided
    function singleSided(Position memory self) internal pure returns (bool) {
        return magnitude(self).eq(self.maker.add(self.long).add(self.short));
    }

    /// @notice Returns the maintenance requirement of the position
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @return The maintenance requirement of the position
    function maintenance(
        Position memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) internal pure returns (UFixed6) {
        if (magnitude(self).isZero()) return UFixed6Lib.ZERO;
        return magnitude(self)
            .mul(latestVersion.price.abs())
            .mul(riskParameter.maintenance)
            .max(riskParameter.minMaintenance);
    }

    /// @notice Returns the whether the position is collateralized
    /// @dev shortfall is considered solvent for 0-position
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @param collateral The current account's collateral
    /// @return Whether the position is collateralized
    function collateralized(
        Position memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        Fixed6 collateral
    ) internal pure returns (bool) {
        return collateral.max(Fixed6Lib.ZERO).gte(Fixed6Lib.from(maintenance(self, latestVersion, riskParameter)));
    }

    /// @notice Returns the liquidation fee of the position
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @return The liquidation fee of the position
    function liquidationFee(
        Position memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) internal pure returns (UFixed6) {
        return maintenance(self, latestVersion, riskParameter)
            .mul(riskParameter.liquidationFee)
            .min(riskParameter.maxLiquidationFee)
            .max(riskParameter.minLiquidationFee);
    }
}

library PositionStorageGlobalLib {
    function read(PositionStorageGlobal storage self) internal view returns (Position memory) {
        StoredPositionGlobal memory storedValue = self.value;

        return Position(
            uint256(storedValue._id),
            uint256(storedValue._timestamp),
            UFixed6.wrap(uint256(storedValue._maker)),
            UFixed6.wrap(uint256(storedValue._long)),
            UFixed6.wrap(uint256(storedValue._short)),
            UFixed6.wrap(uint256(storedValue._fee)),
            UFixed6.wrap(uint256(storedValue._keeper)),
            Fixed6Lib.ZERO,
            Fixed6Lib.ZERO
        );
    }

    function store(PositionStorageGlobal storage self, Position memory newValue) internal {
        PositionStorageLib.validate(newValue);

        self.value = StoredPositionGlobal(
            uint32(newValue.id),
            uint32(newValue.timestamp),
            uint48(UFixed6.unwrap(newValue.maker)),
            uint48(UFixed6.unwrap(newValue.long)),
            uint48(UFixed6.unwrap(newValue.short)),
            uint48(UFixed6.unwrap(newValue.fee)),
            uint48(UFixed6.unwrap(newValue.keeper))
        );
    }
}

library PositionStorageLocalLib {
    function read(PositionStorageLocal storage self) internal view returns (Position memory) {
        StoredPositionLocal memory storedValue = self.value;

        return Position(
            uint256(storedValue._id),
            uint256(storedValue._timestamp),
            UFixed6.wrap(uint256((storedValue._direction == 0) ? storedValue._position : 0)),
            UFixed6.wrap(uint256((storedValue._direction == 1) ? storedValue._position : 0)),
            UFixed6.wrap(uint256((storedValue._direction == 2) ? storedValue._position : 0)),
            UFixed6.wrap(uint256(storedValue._fee)),
            UFixed6.wrap(uint256(storedValue._keeper)),
            Fixed6.wrap(int256(storedValue._collateral)),
            Fixed6.wrap(int256(storedValue._delta))
        );
    }

    function store(PositionStorageLocal storage self, Position memory newValue) internal {
        PositionStorageLib.validate(newValue);

        self.value = StoredPositionLocal(
            uint24(newValue.id),
            uint32(newValue.timestamp),
            uint8(newValue.long.isZero() ? (newValue.short.isZero() ? 0 : 2) : 1),
            uint48(UFixed6.unwrap(newValue.magnitude())),
            uint48(UFixed6.unwrap(newValue.fee)),
            int48(Fixed6.unwrap(newValue.collateral)),
            int48(Fixed6.unwrap(newValue.delta)),
            uint48(UFixed6.unwrap(newValue.keeper))
        );
    }
}

library PositionStorageLib {
    error PositionStorageInvalidError();

    function validate(Position memory newValue) internal pure {
        if (newValue.id > type(uint24).max) revert PositionStorageInvalidError();
        if (newValue.timestamp > type(uint32).max) revert PositionStorageInvalidError();
        if (newValue.maker.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageInvalidError();
        if (newValue.long.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageInvalidError();
        if (newValue.short.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageInvalidError();
        if (newValue.fee.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageInvalidError();
        if (newValue.keeper.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int48).max))) revert PositionStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int48).min))) revert PositionStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int48).max))) revert PositionStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int48).min))) revert PositionStorageInvalidError();
    }
}