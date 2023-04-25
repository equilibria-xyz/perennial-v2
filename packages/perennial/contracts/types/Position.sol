// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "./Order.sol";

/// @dev Position type
struct Position {
    Order order;
    Order pending;
}
using PositionLib for Position global;
struct StoredPosition {
    uint40 _version;
    uint72 _maker;
    uint72 _long;
    uint72 _short;
    uint40 _pendingVersion;
    uint72 _pendingMaker;
    uint72 _pendingLong;
    uint72 _pendingShort;
}
struct PositionStorage { StoredPosition value; }
using PositionStorageLib for PositionStorage global;

/**
 * @title PositionLib
 * @notice Library that surfaces math and settlement computations for the Position type.
 * @dev Positions track the current quantity of the account's maker and taker positions respectively
 *      denominated as a unit of the product's payoff function.
 */
library PositionLib {
    function update(
        Position memory self,
        uint256 version,
        Fixed6 makerAmount,
        Fixed6 longAmount,
        Fixed6 shortAmount
    ) internal pure {
        self.pending.version = version;
        self.pending.maker = UFixed6Lib.from(Fixed6Lib.from(self.pending.maker).add(makerAmount));
        self.pending.long = UFixed6Lib.from(Fixed6Lib.from(self.pending.long).add(longAmount));
        self.pending.short = UFixed6Lib.from(Fixed6Lib.from(self.pending.short).add(shortAmount));
    }

    function settle(Position memory self) internal pure {
        self.order.version = self.pending.version;
        self.order.maker = self.pending.maker;
        self.order.long = self.pending.long;
        self.order.short = self.pending.short;
    }

    /**
     * @notice Returns the utilization ratio for the current position
     * @param self The Position to operate on
     * @return utilization ratio
     */
    function utilization(Position memory self) internal pure returns (UFixed6) {
        //TODO: simplify formula
        UFixed6 _magnitude = magnitude(self);
        UFixed6 _net = net(self);
        UFixed6 buffer = self.order.maker.gt(_net) ? self.order.maker.sub(_net) : UFixed6Lib.ZERO;

        return _magnitude.unsafeDiv(_magnitude.add(buffer));
    }

    function magnitude(Position memory self) internal pure returns (UFixed6) {
        return self.order.long.max(self.order.short);
    }

    function net(Position memory self) internal pure returns (UFixed6) {
        return Fixed6Lib.from(self.order.long).sub(Fixed6Lib.from(self.order.short)).abs();
    }

    function spread(Position memory self) internal pure returns (UFixed6) {
        return net(self).div(magnitude(self));
    }

    function longSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.order.maker.add(self.order.short).min(self.order.long);
    }

    function shortSocialized(Position memory self) internal pure returns (UFixed6) {
        return self.order.maker.add(self.order.long).min(self.order.short);
    }

    function takerSocialized(Position memory self) internal pure returns (UFixed6) {
        return magnitude(self).min(self.order.long.min(self.order.short).add(self.order.maker));
    }

    function socializedNext(Position memory self) internal pure returns (bool) {
        return self.pending.maker.add(self.pending.short).lt(self.pending.long) || self.pending.maker.add(self.pending.long).lt(self.pending.short);
    }
}

library PositionStorageLib {
    error PositionStorageInvalidError();

    function read(PositionStorage storage self) internal view returns (Position memory) {
        StoredPosition memory storedValue =  self.value;
        return Position(
            Order(
                uint256(storedValue._version),
                UFixed6.wrap(uint256(storedValue._maker)),
                UFixed6.wrap(uint256(storedValue._long)),
                UFixed6.wrap(uint256(storedValue._short))
            ),
            Order(
                uint256(storedValue._pendingVersion),
                UFixed6.wrap(uint256(storedValue._pendingMaker)),
                UFixed6.wrap(uint256(storedValue._pendingLong)),
                UFixed6.wrap(uint256(storedValue._pendingShort))
            )
        );
    }

    function store(PositionStorage storage self, Position memory newValue) internal {
        if (newValue.order.version > type(uint40).max) revert PositionStorageInvalidError();
        if (newValue.order.maker.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.order.long.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.order.short.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.pending.version > type(uint40).max) revert PositionStorageInvalidError();
        if (newValue.pending.maker.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.pending.long.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();
        if (newValue.pending.short.gt(UFixed6Lib.MAX_72)) revert PositionStorageInvalidError();

        self.value = StoredPosition(
            uint40(newValue.order.version),
            uint72(UFixed6.unwrap(newValue.order.maker)),
            uint72(UFixed6.unwrap(newValue.order.long)),
            uint72(UFixed6.unwrap(newValue.order.short)),
            uint40(newValue.pending.version),
            uint72(UFixed6.unwrap(newValue.pending.maker)),
            uint72(UFixed6.unwrap(newValue.pending.long)),
            uint72(UFixed6.unwrap(newValue.pending.short))
        );
    }
}
