// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./Order.sol";

/// @dev Order type
struct Position {
    uint256 id; // TODO: try to remove
    uint256 version;
    UFixed6 maker;
    UFixed6 long;
    UFixed6 short;
    UFixed6 fee; // TODO: unused in the non-pending instances
    Fixed6 collateral; // TODO: unused in the non-pending and global instances
    Fixed6 delta; // TODO: unused in the non-pending and global instances
}
using PositionLib for Position global;
struct StoredPositionGlobal {
    uint32 _id;
    uint32 _version;
    uint48 _maker;
    uint48 _long;
    uint48 _short;
    uint48 _fee;
}
struct PositionStorageGlobal { StoredPositionGlobal value; }
using PositionStorageGlobalLib for PositionStorageGlobal global;
struct StoredPositionLocal {
    uint24 _id;
    uint32 _version;
    uint8 _direction;
    uint48 _position;
    uint48 _fee;
    int48 _collateral;
    int48 _delta;
}
struct PositionStorageLocal { StoredPositionLocal value; }
using PositionStorageLocalLib for PositionStorageLocal global;

/**
 * @title PositionLib
 * @notice Library
 */
library PositionLib {
    function ready(Position memory self, OracleVersion memory latestVersion) internal pure returns (bool) {
        return latestVersion.version >= self.version;
    }

    /// @dev update the latest position
    function update(Position memory self, Position memory newPosition) internal pure {
        (self.id, self.version, self.maker, self.long, self.short) = (
            newPosition.id,
            newPosition.version,
            newPosition.maker,
            newPosition.long,
            newPosition.short
        );
    }

    /// @dev update the current local position
    function update(
        Position memory self,
        uint256 currentId,
        uint256 currentVersion,
        UFixed6 newMaker,
        UFixed6 newLong,
        UFixed6 newShort,
        OracleVersion memory latestVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (Order memory newOrder) {
        (newOrder.maker, newOrder.long, newOrder.short) = (
            Fixed6Lib.from(newMaker).sub(Fixed6Lib.from(self.maker)),
            Fixed6Lib.from(newLong).sub(Fixed6Lib.from(self.long)),
            newOrder.short = Fixed6Lib.from(newShort).sub(Fixed6Lib.from(self.short))
        );
        newOrder.registerFee(latestVersion, marketParameter);

        (self.id, self.version, self.maker, self.long, self.short, self.fee) = (
            currentId,
            currentVersion,
            newMaker,
            newLong,
            newShort,
            self.id == currentId ? self.fee.add(newOrder.fee) : newOrder.fee
        );
    }

    /// @dev update the current global position
    function update(Position memory self, uint256 currentId, uint256 currentVersion, Order memory order) internal pure {
        (self.id, self.version, self.maker, self.long, self.short, self.fee) = (
            currentId,
            currentVersion,
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(order.maker)),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(order.long)),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(order.short)),
            self.id == currentId ? self.fee.add(order.fee) : order.fee
        );
    }

    /// @dev update the collateral delta of the local position
    function update(Position memory self, Fixed6 collateralAmount) internal pure {
        self.delta = self.delta.add(collateralAmount);
    }

    function magnitude(Position memory self) internal pure returns (UFixed6) {
        return self.long.max(self.short).max(self.maker);
    }

    function major(Position memory self) internal pure returns (UFixed6) {
        return self.long.max(self.short);
    }

    function minor(Position memory self) internal pure returns (UFixed6) {
        return self.long.min(self.short);
    }

    function net(Position memory self) internal pure returns (UFixed6) {
        return Fixed6Lib.from(self.long).sub(Fixed6Lib.from(self.short)).abs();
    }

    function spread(Position memory self) internal pure returns (UFixed6) {
        return net(self).div(major(self));
    }

    function utilization(Position memory self) internal pure returns (UFixed6) {
        return major(self).unsafeDiv(self.maker.add(minor(self)));
    }

    function longSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.short).min(self.long);
    }

    function shortSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.long).min(self.short);
    }

    function takerSocialized(Position memory self) internal pure returns (UFixed6) {
        return major(self).min(minor(self).add(self.maker));
    }

    function socialized(Position memory self) internal pure returns (bool) {
        return self.maker.add(self.short).lt(self.long) || self.maker.add(self.long).lt(self.short);
    }

    function singleSided(Position memory self) internal pure returns (bool) {
        return magnitude(self).eq(self.maker.add(self.long).add(self.short));
    }

    function maintenance(
        Position memory self,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6) {
        return magnitude(self).mul(currentOracleVersion.price.abs()).mul(marketParameter.maintenance);
    }

    function liquidationFee(
        Position memory self,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter,
        ProtocolParameter memory protocolParameter
    ) internal pure returns (UFixed6) {
        return maintenance(self, currentOracleVersion, marketParameter)
            .max(protocolParameter.minCollateral)
            .mul(protocolParameter.liquidationFee
        );
    }

    function sub(Position memory self, Position memory position) internal pure returns (Order memory newOrder) {
        (newOrder.maker, newOrder.long, newOrder.short) = (
            Fixed6Lib.from(self.maker).sub(Fixed6Lib.from(position.maker)),
            Fixed6Lib.from(self.long).sub(Fixed6Lib.from(position.long)),
            Fixed6Lib.from(self.short).sub(Fixed6Lib.from(position.short))
        );
    }
}

library PositionStorageGlobalLib {
    error PositionStorageGlobalInvalidError();

    function read(PositionStorageGlobal storage self) internal view returns (Position memory) {
        StoredPositionGlobal memory storedValue = self.value;

        return Position(
            uint256(storedValue._id),
            uint256(storedValue._version),
            UFixed6.wrap(uint256(storedValue._maker)),
            UFixed6.wrap(uint256(storedValue._long)),
            UFixed6.wrap(uint256(storedValue._short)),
            UFixed6.wrap(uint256(storedValue._fee)),
            Fixed6Lib.ZERO,
            Fixed6Lib.ZERO
        );
    }

    function store(PositionStorageGlobal storage self, Position memory newValue) internal {
        if (newValue.id > uint256(type(uint32).max)) revert PositionStorageGlobalInvalidError();
        if (newValue.version > uint256(type(uint32).max)) revert PositionStorageGlobalInvalidError();
        if (newValue.maker.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageGlobalInvalidError();
        if (newValue.long.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageGlobalInvalidError();
        if (newValue.short.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageGlobalInvalidError();
        if (newValue.fee.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageGlobalInvalidError();

        self.value = StoredPositionGlobal(
            uint32(newValue.id),
            uint32(newValue.version),
            uint48(UFixed6.unwrap(newValue.maker)),
            uint48(UFixed6.unwrap(newValue.long)),
            uint48(UFixed6.unwrap(newValue.short)),
            uint48(UFixed6.unwrap(newValue.fee))
        );
    }
}

library PositionStorageLocalLib {
    error PositionStorageLocalInvalidError();

    function read(PositionStorageLocal storage self) internal view returns (Position memory) {
        StoredPositionLocal memory storedValue = self.value;

        return Position(
            uint256(storedValue._id),
            uint256(storedValue._version),
            UFixed6.wrap(uint256((storedValue._direction == 0) ? storedValue._position : 0)),
            UFixed6.wrap(uint256((storedValue._direction == 1) ? storedValue._position : 0)),
            UFixed6.wrap(uint256((storedValue._direction == 2) ? storedValue._position : 0)),
            UFixed6.wrap(uint256(storedValue._fee)),
            Fixed6.wrap(int256(storedValue._collateral)),
            Fixed6.wrap(int256(storedValue._delta))
        );
    }

    function store(PositionStorageLocal storage self, Position memory newValue) internal {
        if (newValue.id > type(uint24).max) revert PositionStorageLocalInvalidError();
        if (newValue.version > type(uint32).max) revert PositionStorageLocalInvalidError();
        if (newValue.maker.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageLocalInvalidError();
        if (newValue.long.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageLocalInvalidError();
        if (newValue.short.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageLocalInvalidError();
        if (newValue.fee.gt(UFixed6.wrap(type(uint48).max))) revert PositionStorageLocalInvalidError();
        if (newValue.collateral.gt(Fixed6.wrap(type(int48).max))) revert PositionStorageLocalInvalidError();
        if (newValue.collateral.lt(Fixed6.wrap(type(int48).min))) revert PositionStorageLocalInvalidError();
        if (newValue.delta.gt(Fixed6.wrap(type(int48).max))) revert PositionStorageLocalInvalidError();
        if (newValue.delta.lt(Fixed6.wrap(type(int48).min))) revert PositionStorageLocalInvalidError();

        self.value = StoredPositionLocal(
            uint24(newValue.id),
            uint32(newValue.version),
            uint8(newValue.long.isZero() ? (newValue.short.isZero() ? 0 : 2) : 1),
            uint48(UFixed6.unwrap(newValue.magnitude())),
            uint48(UFixed6.unwrap(newValue.fee)),
            int48(Fixed6.unwrap(newValue.collateral)),
            int48(Fixed6.unwrap(newValue.delta))
        );
    }
}