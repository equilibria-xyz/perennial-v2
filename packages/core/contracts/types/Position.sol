// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6, Fixed6Lib } from "@equilibria/root/number/types/Fixed6.sol";
import { OracleVersion } from "./OracleVersion.sol";
import { RiskParameter } from "./RiskParameter.sol";
import { Order } from "./Order.sol";

/// @dev Position type
struct Position {
    /// @dev The timestamp of the position
    uint256 timestamp;

    /// @dev The maker position size
    UFixed6 maker;

    /// @dev The long position size
    UFixed6 long;

    /// @dev The short position size
    UFixed6 short;
}
using PositionLib for Position global;
struct PositionStorageGlobal { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using PositionStorageGlobalLib for PositionStorageGlobal global;
struct PositionStorageLocal { uint256 slot0; uint256 slot1; } // SECURITY: must remain at (2) slots
using PositionStorageLocalLib for PositionStorageLocal global;

/// @title Position
/// @dev (external-unsafe): this library must be used internally only
/// @notice Holds the state for a position
library PositionLib {
    /// @notice Returns a cloned copy of the position
    /// @param self The position object to clone
    /// @return A cloned copy of the position
    function clone(Position memory self) internal pure returns (Position memory) {
        return Position(self.timestamp, self.maker, self.long, self.short);
    }

    /// @notice Updates the position with a new order
    /// @param self The position object to update
    /// @param order The new order
    function update(Position memory self, Order memory order) internal pure {
        self.timestamp = order.timestamp;

        (self.maker, self.long, self.short) = (
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(order.maker())),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(order.long())),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(order.short()))
        );
    }

    /// @notice Returns the direction of the position
    /// @dev 0 = maker, 1 = long, 2 = short
    /// @param self The position object to check
    /// @return The direction of the position
    function direction(Position memory self) internal pure returns (uint256) {
        return self.long.isZero() ? (self.short.isZero() ? 0 : 2) : 1;
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

    /// @notice Returns the whether the position is single-sided
    /// @param self The position object to check
    /// @return Whether the position is single-sided
    function singleSided(Position memory self) internal pure returns (bool) {
        return magnitude(self).eq(self.long.add(self.short).add(self.maker));
    }

    /// @notice Returns the whether the position is empty
    /// @param self The position object to check
    /// @return Whether the position is empty
    function empty(Position memory self) internal pure returns (bool) {
        return magnitude(self).isZero();
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
    /// @param collateralization The collateralization requirement override provided by the caller
    /// @return The margin requirement of the position
    function margin(
        UFixed6 positionMagnitude,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        UFixed6 collateralization
    ) internal pure returns (UFixed6) {
        return _collateralRequirement(positionMagnitude, latestVersion, riskParameter.margin.max(collateralization), riskParameter.minMargin);
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
        return margin(magnitude(self), latestVersion, riskParameter, UFixed6Lib.ZERO);
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
    /// @param collateralization The collateralization requirement override provided by the caller
    /// @param collateral The current account's collateral
    /// @return Whether the position is margined
    function margined(
        UFixed6 positionMagnitude,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        UFixed6 collateralization,
        Fixed6 collateral
    ) internal pure returns (bool) {
        return UFixed6Lib.unsafeFrom(collateral).gte(margin(positionMagnitude, latestVersion, riskParameter, collateralization));
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
    /// @param collateralization The collateralization requirement override provided by the caller
    /// @param collateral The current account's collateral
    /// @return Whether the position is margined
    function margined(
        Position memory self,
        OracleVersion memory latestVersion,
        RiskParameter memory riskParameter,
        UFixed6 collateralization,
        Fixed6 collateral
    ) internal pure returns (bool) {
        return margined(magnitude(self), latestVersion, riskParameter, collateralization, collateral);
    }
}

/// @dev Manually encodes and decodes the global Position struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredPositionGlobal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint32 __unallocated__;
///         uint64 maker;
///         uint64 long;
///         uint64 short;
///     }
///
library PositionStorageGlobalLib {
    function read(PositionStorageGlobal storage self) internal view returns (Position memory) {
        uint256 slot0 = self.slot0;
        return Position(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64)) >> (256 - 64)),
            UFixed6.wrap(uint256(slot0 << (256 - 32 - 32 - 64 - 64 - 64)) >> (256 - 64))
        );
    }

    function store(PositionStorageGlobal storage self, Position memory newValue) public {
        PositionStorageLib.validate(newValue);

        if (newValue.maker.gt(UFixed6.wrap(type(uint64).max))) revert PositionStorageLib.PositionStorageInvalidError();
        if (newValue.long.gt(UFixed6.wrap(type(uint64).max))) revert PositionStorageLib.PositionStorageInvalidError();
        if (newValue.short.gt(UFixed6.wrap(type(uint64).max))) revert PositionStorageLib.PositionStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(UFixed6.unwrap(newValue.maker) << (256 - 64)) >> (256 - 32 - 32 - 64) |
            uint256(UFixed6.unwrap(newValue.long) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64) |
            uint256(UFixed6.unwrap(newValue.short) << (256 - 64)) >> (256 - 32 - 32 - 64 - 64 - 64);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

/// @dev Manually encodes and decodes the local Position struct into storage.
///      (external-safe): this library is safe to externalize
///
///     struct StoredPositionLocal {
///         /* slot 0 */
///         uint32 timestamp;
///         uint2 direction;
///         uint62 magnitude;
///         uint160 __unallocated__;
///     }
///
library PositionStorageLocalLib {
    function read(PositionStorageLocal storage self) internal view returns (Position memory) {
        uint256 slot0 = self.slot0;

        uint256 direction = uint256(slot0 << (256 - 32 - 2)) >> (256 - 2);
        UFixed6 magnitude = UFixed6.wrap(uint256(slot0 << (256 - 32 - 2 - 62)) >> (256 - 62));

        return Position(
            uint256(slot0 << (256 - 32)) >> (256 - 32),
            direction == 0 ? magnitude : UFixed6Lib.ZERO,
            direction == 1 ? magnitude : UFixed6Lib.ZERO,
            direction == 2 ? magnitude : UFixed6Lib.ZERO
        );
    }

    function store(PositionStorageLocal storage self, Position memory newValue) external {
        PositionStorageLib.validate(newValue);

        UFixed6 magnitude = newValue.magnitude();

        if (magnitude.gt(UFixed6.wrap(2 ** 62 - 1))) revert PositionStorageLib.PositionStorageInvalidError();

        uint256 encoded0 =
            uint256(newValue.timestamp << (256 - 32)) >> (256 - 32) |
            uint256(newValue.direction() << (256 - 2)) >> (256 - 32 - 2) |
            uint256(UFixed6.unwrap(magnitude) << (256 - 62)) >> (256 - 32 - 2 - 62);

        assembly {
            sstore(self.slot, encoded0)
        }
    }
}

library PositionStorageLib {
    // sig: 0x52a8a97f
    error PositionStorageInvalidError();

    function validate(Position memory newValue) internal pure {
        if (newValue.timestamp > type(uint32).max) revert PositionStorageInvalidError();
    }
}