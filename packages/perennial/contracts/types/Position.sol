// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./OracleVersion.sol";
import "./RiskParameter.sol";
import "./Order.sol";
import "./Global.sol";
import "./Local.sol";
import "./Invalidation.sol";

/// @dev Order type
struct Position {
    /// @dev The timestamp of the position
    uint256 timestamp;

    /// @dev The maker position size
    UFixed6 maker;

    /// @dev The long position size
    UFixed6 long;

    /// @dev The short position size
    UFixed6 short;

    /// @dev The fee for the position (only used for pending positions)
    Fixed6 fee;

    /// @dev The fixed settlement fee for the position (only used for pending positions)
    UFixed6 keeper;

    /// @dev The collateral at the time of the position settlement (only used for pending positions)
    Fixed6 collateral;

    /// @dev The change in collateral during this position (only used for pending positions)
    Fixed6 delta;

    /// @dev The value of the invalidation accumulator at the time of creation
    Invalidation invalidation;
}
using PositionLib for Position global;
struct PositionStorageGlobal { uint256 slot0; uint256 slot1; }
using PositionStorageGlobalLib for PositionStorageGlobal global;
struct PositionStorageLocal { uint256 slot0; uint256 slot1; }
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
        (self.timestamp, self.maker, self.long, self.short) =
            (newPosition.timestamp, newPosition.maker, newPosition.long, newPosition.short);
    }

    /// @notice Updates the current local position with a new order
    /// @param self The position object to update
    /// @param currentTimestamp The current timestamp
    /// @param newMaker The new maker position
    /// @param newLong The new long position
    /// @param newShort The new short position
    /// @return newOrder The new order
    function update(
        Position memory self,
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

        (self.timestamp, self.maker, self.long, self.short) = (currentTimestamp, newMaker, newLong, newShort);
    }

    /// @notice Updates the current global position with a new order
    /// @param self The position object to update
    /// @param currentTimestamp The current timestamp
    /// @param order The new order
    function update(
        Position memory self,
        uint256 currentTimestamp,
        Order memory order
    ) internal pure {
        // load the computed attributes of the latest position
        (order.net, order.efficiency, order.latestMaker, order.latestSkew) =
            (Fixed6Lib.from(net(self)), Fixed6Lib.from(efficiency(self)), self.maker, skew(self));

        // update the position's attributes
        (self.timestamp, self.maker, self.long, self.short) = (
            currentTimestamp,
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(order.maker)),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(order.long)),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(order.short))
        );

        // update the order's delta attributes with the positions updated attributes
        (order.currentMaker, order.currentSkew, order.efficiency) = (
            self.maker,
            skew(self),
            Fixed6Lib.from(efficiency(self)).sub(order.efficiency)
        );
    }

    /// @notice prepares the position for the next id
    /// @param self The position object to update
    function prepare(Position memory self) internal pure {
        self.fee = Fixed6Lib.ZERO;
        self.keeper = UFixed6Lib.ZERO;
        self.collateral = Fixed6Lib.ZERO;
    }

    /// @notice Updates the collateral delta of the position
    /// @param self The position object to update
    /// @param collateralAmount The amount of collateral change that occurred
    function update(Position memory self, Fixed6 collateralAmount) internal pure {
        self.delta = self.delta.add(collateralAmount);
    }

    /// @notice Processes an invalidation of a position
    /// @dev Increments the invalidation accumulator by the new position's delta, and resets the fee
    /// @param self The position object to update
    /// @param newPosition The latest valid position
    function invalidate(Position memory self, Position memory newPosition) internal pure {
        self.invalidation.increment(self, newPosition);
        (newPosition.maker, newPosition.long, newPosition.short, newPosition.fee) =
            (self.maker, self.long, self.short, Fixed6Lib.ZERO);
    }

    // @notice Adjusts the position if any invalidations have occurred
    /// @param self The position object to update
    /// @param latestPosition The latest settled position from which to compare invalidation accumualtors
    function adjust(Position memory self, Position memory latestPosition) internal pure {
        Invalidation memory invalidation = latestPosition.invalidation.sub(self.invalidation);
        (self.maker, self.long, self.short) = (
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(invalidation.maker)),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(invalidation.long)),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(invalidation.short))
        );
    }

    /// @notice Processes a sync of the position
    /// @dev Moves the timestamp forward to the latest version's timestamp, while resetting the fee and keeper
    /// @param self The position object to update
    /// @param latestVersion The latest oracle version
    function sync(Position memory self, OracleVersion memory latestVersion) internal pure {
        (self.timestamp, self.fee, self.keeper) = (latestVersion.timestamp, Fixed6Lib.ZERO, UFixed6Lib.ZERO);
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
    /// @param self The position object to check
    /// @return The skew of the position
    function skew(Position memory self) internal pure returns (Fixed6) {
        return Fixed6Lib.from(self.long).sub(Fixed6Lib.from(self.short));
    }

    /// @notice Returns the utilization of the position
    /// @dev utilization = major / (maker + minor)
    /// @param self The position object to check
    /// @param riskParameter The current risk parameter
    /// @return The utilization of the position
    function utilization(Position memory self, RiskParameter memory riskParameter) internal pure returns (UFixed6) {
        // long-short net utilization of the maker position
        UFixed6 netUtilization = major(self).unsafeDiv(self.maker.add(minor(self)));

        // efficiency limit utilization of the maker position
        UFixed6 efficiencyUtilization = major(self).mul(riskParameter.efficiencyLimit).unsafeDiv(self.maker);
        
        // maximum of the two utilizations, capped at 100%
        return netUtilization.max(efficiencyUtilization).min(UFixed6Lib.ONE);
    }

    /// @notice Returns the portion of the position that is covered by the maker
    /// @param self The position object to check
    /// @return The portion of the position that is covered by the maker
    function socializedMakerPortion(Position memory self) internal pure returns (UFixed6) {
        return takerSocialized(self).isZero() ?
            UFixed6Lib.ZERO :
            takerSocialized(self).sub(minor(self)).div(takerSocialized(self));
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

    /// @notice Returns the maintenance requirement of the position
    /// @param positionMagnitude The position magnitude value to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @return The maintenance requirement of the position
    function maintenance(
        UFixed6 positionMagnitude,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) internal pure returns (UFixed6) {
        return _collateralRequirement(positionMagnitude, latestVersion, riskParameter.maintenance, riskParameter.minMaintenance);
    }

    /// @notice Returns the margin requirement of the position
    /// @param positionMagnitude The position magnitude value to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @return The margin requirement of the position
    function margin(
        UFixed6 positionMagnitude,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) internal pure returns (UFixed6) {
        return _collateralRequirement(positionMagnitude, latestVersion, riskParameter.margin, riskParameter.minMargin);
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
        return maintenance(magnitude(self), latestVersion, riskParameter);
    }

    /// @notice Returns the margin requirement of the position
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @return The margin requirement of the position
    function margin(
        Position memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter
    ) internal pure returns (UFixed6) {
        return margin(magnitude(self), latestVersion, riskParameter);
    }

    /// @notice Returns the collateral requirement of the position magnitude
    /// @param positionMagnitude The position magnitude value to check
    /// @param latestVersion The latest oracle version
    /// @param requirementRatio The ratio requirement to the notional
    /// @param requirementFixed The fixed requirement
    /// @return The collateral requirement of the position magnitude
    function _collateralRequirement(
        UFixed6 positionMagnitude,
        OracleVersion memory latestVersion,
        UFixed6 requirementRatio,
        UFixed6 requirementFixed
    ) private pure returns (UFixed6) {
        if (positionMagnitude.isZero()) return UFixed6Lib.ZERO;
        return positionMagnitude.mul(latestVersion.price.abs()).mul(requirementRatio).max(requirementFixed);
    }

    /// @notice Returns the whether the position is maintained
    /// @dev shortfall is considered solvent for 0-position
    /// @param positionMagnitude The position magnitude value to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @param collateral The current account's collateral
    /// @return Whether the position is maintained
    function maintained(
        UFixed6 positionMagnitude,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        Fixed6 collateral
    ) internal pure returns (bool) {
        return UFixed6Lib.unsafeFrom(collateral).gte(maintenance(positionMagnitude, latestVersion, riskParameter));
    }

    /// @notice Returns the whether the position is margined
    /// @dev shortfall is considered solvent for 0-position
    /// @param positionMagnitude The position magnitude value to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @param collateral The current account's collateral
    /// @return Whether the position is margined
    function margined(
        UFixed6 positionMagnitude,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        Fixed6 collateral
    ) internal pure returns (bool) {
        return UFixed6Lib.unsafeFrom(collateral).gte(margin(positionMagnitude, latestVersion, riskParameter));
    }

    /// @notice Returns the whether the position is maintained
    /// @dev shortfall is considered solvent for 0-position
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @param collateral The current account's collateral
    /// @return Whether the position is maintained
    function maintained(
        Position memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        Fixed6 collateral
    ) internal pure returns (bool) {
        return maintained(magnitude(self), latestVersion, riskParameter, collateral);
    }

    /// @notice Returns the whether the position is margined
    /// @dev shortfall is considered solvent for 0-position
    /// @param self The position object to check
    /// @param latestVersion The latest oracle version
    /// @param riskParameter The current risk parameter
    /// @param collateral The current account's collateral
    /// @return Whether the position is margined
    function margined(
        Position memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        Fixed6 collateral
    ) internal pure returns (bool) {
        return margined(magnitude(self), latestVersion, riskParameter, collateral);
    }
}

/// @dev Manually encodes and decodes the global Position struct into storage.
///
///     struct StoredPositionGlobal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint48 fee;
///         uint48 keeper;
///         uint64 long;
///         uint64 short;
///
///         /* slot 1 */
///         uint64 maker;
///         int64 invalidation.maker;
///         int64 invalidation.long;
///         int64 invalidation.short;
///     }
///
library PositionStorageGlobalLib {
    function read(PositionStorageGlobal storage self) internal view returns (Position memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return Position(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            UFixed6.wrap(uint256(slot1 << (256 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 48 - 48 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 48 - 48 - 64 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot0   << (256 - 32 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 48 - 48)) >> (256 - 48)),
            Fixed6Lib.ZERO,
            Fixed6Lib.ZERO,
            Invalidation(
                Fixed6.wrap(int256(slot1 << (256 - 64 - 64)) >> (256 - 64)),
                Fixed6.wrap(int256(slot1 << (256 - 64 - 64 - 64)) >> (256 - 64)),
                Fixed6.wrap(int256(slot1 << (256 - 64 - 64 - 64 - 64)) >> (256 - 64))
            )
        );
    }

    function store(PositionStorageGlobal storage self, Position memory newValue) internal {
        PositionStorageLib.validate(newValue);

        if (newValue.maker.gt(UFixed6.wrap(type(uint64).max))) revert PositionStorageLib.PositionStorageInvalidError();
        if (newValue.long.gt(UFixed6.wrap(type(uint64).max))) revert PositionStorageLib.PositionStorageInvalidError();
        if (newValue.short.gt(UFixed6.wrap(type(uint64).max))) revert PositionStorageLib.PositionStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.fee) << (256 - 48)) >> (256 - 32 - 48) |
            uint256(UFixed6.unwrap(newValue.keeper) << (256 - 48)) >> (256 - 32 - 48 - 48) |
            uint256(UFixed6.unwrap(newValue.long) << (256 - 64)) >> (256 - 32 - 48 - 48 - 64) |
            uint256(UFixed6.unwrap(newValue.short) << (256 - 64)) >> (256 - 32 - 48 - 48 - 64 - 64);
        uint256 encoded1 =
            uint256(UFixed6.unwrap(newValue.maker) << (256 - 64)) >> (256 - 64) |
            uint256(Fixed6.unwrap(newValue.invalidation.maker) << (256 - 64)) >> (256 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.invalidation.long) << (256 - 64)) >> (256 - 64 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.invalidation.short) << (256 - 64)) >> (256 - 64 - 64 - 64 - 64);


        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}

/// @dev Manually encodes and decodes the local Position struct into storage.
///
///     struct StoredPositionLocal {
///         /* slot 0 */
///         uint32 timestamp;
///         int48 fee;
///         uint48 keeper;
///         int64 collateral;
///         int64 delta;
///
///         /* slot 1 */
///         uint2 direction;
///         uint62 magnitude;
///         int64 invalidation.maker;
///         int64 invalidation.long;
///         int64 invalidation.short;
///     }
///
library PositionStorageLocalLib {
    function read(PositionStorageLocal storage self) internal view returns (Position memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);

        uint256 direction = uint256(slot1 << (256 - 2)) >> (256 - 2);
        UFixed6 magnitude = UFixed6.wrap(uint256(slot1 << (256 - 2 - 62)) >> (256 - 62));

        return Position(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            direction == 0 ? magnitude : UFixed6Lib.ZERO,
            direction == 1 ? magnitude : UFixed6Lib.ZERO,
            direction == 2 ? magnitude : UFixed6Lib.ZERO,
            Fixed6.wrap(int256(slot0 << (256 - 32 - 48)) >> (256 - 48)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 48 - 48)) >> (256 - 48)),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 48 - 48 - 64)) >> (256 - 64)),
            Fixed6.wrap(int256(slot0 << (256 - 32 - 48 - 48 - 64 - 64)) >> (256 - 64)),
            Invalidation(
                Fixed6.wrap(int256(slot1 << (256 - 2 - 62 - 64)) >> (256 - 64)),
                Fixed6.wrap(int256(slot1 << (256 - 2 - 62 - 64 - 64)) >> (256 - 64)),
                Fixed6.wrap(int256(slot1 << (256 - 2 - 62 - 64 - 64 - 64)) >> (256 - 64))
            )
        );
    }

    function store(PositionStorageLocal storage self, Position memory newValue) internal {
        PositionStorageLib.validate(newValue);

        if (newValue.maker.gt(UFixed6.wrap(2 ** 62 - 1))) revert PositionStorageLib.PositionStorageInvalidError();
        if (newValue.long.gt(UFixed6.wrap(2 ** 62 - 1))) revert PositionStorageLib.PositionStorageInvalidError();
        if (newValue.short.gt(UFixed6.wrap(2 ** 62 - 1))) revert PositionStorageLib.PositionStorageInvalidError();

        uint256 direction = newValue.long.isZero() ? (newValue.short.isZero() ? 0 : 2) : 1;

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(Fixed6.unwrap(newValue.fee) << (256 - 48)) >> (256 - 32 - 48) |
            uint256(UFixed6.unwrap(newValue.keeper) << (256 - 48)) >> (256 - 32 - 48 - 48) |
            uint256(Fixed6.unwrap(newValue.collateral) << (256 - 64)) >> (256 - 32 - 48 - 48 - 64) |
            uint256(Fixed6.unwrap(newValue.delta) << (256 - 64)) >> (256 - 32 - 48 - 48 - 64 - 64);
        uint256 encoded1 =
            uint256(direction << (256 - 2)) >> (256 - 2) |
            uint256(UFixed6.unwrap(newValue.magnitude()) << (256 - 62)) >> (256 - 2 - 62) |
            uint256(Fixed6.unwrap(newValue.invalidation.maker) << (256 - 64)) >> (256 - 2 - 62 - 64) |
            uint256(Fixed6.unwrap(newValue.invalidation.long) << (256 - 64)) >> (256 - 2 - 62 - 64 - 64) |
            uint256(Fixed6.unwrap(newValue.invalidation.short) << (256 - 64)) >> (256 - 2 - 62 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}

library PositionStorageLib {
    // sig: 0x52a8a97f
    error PositionStorageInvalidError();

    function validate(Position memory newValue) internal pure {
        if (newValue.timestamp > type(uint32).max) revert PositionStorageInvalidError();
        if (newValue.fee.gt(Fixed6.wrap(type(int48).max))) revert PositionStorageInvalidError();
        if (newValue.fee.lt(Fixed6.wrap(type(int48).min))) revert PositionStorageInvalidError();
        if (newValue.keeper.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int64).max))) revert PositionStorageInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int64).min))) revert PositionStorageInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int64).max))) revert PositionStorageInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int64).min))) revert PositionStorageInvalidError();
        if (newValue.invalidation.maker.gt(Fixed6.wrap(type(int64).max))) revert PositionStorageInvalidError();
        if (newValue.invalidation.maker.lt(Fixed6.wrap(type(int64).min))) revert PositionStorageInvalidError();
        if (newValue.invalidation.long.gt(Fixed6.wrap(type(int64).max))) revert PositionStorageInvalidError();
        if (newValue.invalidation.long.lt(Fixed6.wrap(type(int64).min))) revert PositionStorageInvalidError();
        if (newValue.invalidation.short.gt(Fixed6.wrap(type(int64).max))) revert PositionStorageInvalidError();
        if (newValue.invalidation.short.lt(Fixed6.wrap(type(int64).min))) revert PositionStorageInvalidError();
    }
}