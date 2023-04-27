// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./Order.sol";

/// @dev Order type
struct Position {
    uint256 version;
    UFixed6 maker;
    UFixed6 long;
    UFixed6 short;
}
using PositionLib for Position global;
struct StoredPosition {
    uint40 _version;
    uint72 _maker;
    uint72 _long;
    uint72 _short;
}
struct PositionStorage { StoredPosition value; }
using PositionStorageLib for PositionStorage global;

/**
 * @title PositionLib
 * @notice Library
 */
library PositionLib {
    function ready(Position memory self, OracleVersion memory currentOracleVersion) internal pure returns (bool) {
        return currentOracleVersion.version >= self.version;
    }

    function update(Position memory self, Position memory newPosition) internal pure {
        (self.version, self.maker, self.long, self.short) =
            (newPosition.version, newPosition.maker, newPosition.long, newPosition.short);
    }

    function update(Position memory self, uint256 newVersion, Order memory order) internal pure {
        self.version = newVersion;
        update(self, add(self, order));
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

    function sub(Position memory self, Position memory position) internal pure returns (Order memory) {
        return Order(
            Fixed6Lib.from(self.maker).sub(Fixed6Lib.from(position.maker)),
            Fixed6Lib.from(self.long).sub(Fixed6Lib.from(position.long)),
            Fixed6Lib.from(self.short).sub(Fixed6Lib.from(position.short))
        );
    }

    function add(Position memory self, Order memory order) internal pure returns (Position memory) {
        return Position(
            self.version,
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(order.maker)),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(order.long)),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(order.short))
        );
    }
}

library PositionStorageLib {
    error PositionStorageInvalidError();

    function read(PositionStorage storage self) internal view returns (Position memory) {
        StoredPosition memory storedValue =  self.value;

        return Position(
            uint256(storedValue._version),
            UFixed6.wrap(uint256(storedValue._maker)),
            UFixed6.wrap(uint256(storedValue._long)),
            UFixed6.wrap(uint256(storedValue._short))
        );
    }

    function store(PositionStorage storage self, Position memory newValue) internal {
        if (newValue.version > type(uint40).max) revert PositionStorageInvalidError();
        if (newValue.maker.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.long.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.short.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();

        self.value = StoredPosition(
            uint40(newValue.version),
            uint72(UFixed6.unwrap(newValue.maker)),
            uint72(UFixed6.unwrap(newValue.long)),
            uint72(UFixed6.unwrap(newValue.short))
        );
    }
}