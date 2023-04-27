// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./ProtocolParameter.sol";
import "./MarketParameter.sol";
import "./OrderDelta.sol";

/// @dev Order type
struct Order {
    uint256 version;
    UFixed6 maker;
    UFixed6 long;
    UFixed6 short;
}
using OrderLib for Order global;
struct StoredOrder {
    uint40 _version;
    uint72 _maker;
    uint72 _long;
    uint72 _short;
}
struct OrderStorage { StoredOrder value; }
using OrderStorageLib for OrderStorage global;

/**
 * @title OrderLib
 * @notice Library
 */
library OrderLib {
    function ready(Order memory self, OracleVersion memory currentOracleVersion) internal pure returns (bool) {
        return currentOracleVersion.version >= self.version;
    }

    function update(Order memory self, Order memory newOrder) internal pure {
        (self.version, self.maker, self.long, self.short) =
            (newOrder.version, newOrder.maker, newOrder.long, newOrder.short);
    }

    function update(Order memory self, uint256 newVersion, OrderDelta memory orderDelta) internal pure {
        self.version = newVersion;
        update(self, add(self, orderDelta));
    }

    function position(Order memory self) internal pure returns (UFixed6) {
        return self.long.max(self.short).max(self.maker);
    }

    function magnitude(Order memory self) internal pure returns (UFixed6) {
        return self.long.max(self.short);
    }

    function net(Order memory self) internal pure returns (UFixed6) {
        return Fixed6Lib.from(self.long).sub(Fixed6Lib.from(self.short)).abs();
    }

    function spread(Order memory self) internal pure returns (UFixed6) {
        return net(self).div(magnitude(self));
    }

    function utilization(Order memory self) internal pure returns (UFixed6) {
        return magnitude(self).unsafeDiv(self.maker.add(self.long.min(self.short)));
    }

    function longSocialized(Order memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.short).min(self.long);
    }

    function shortSocialized(Order memory self) internal pure returns (UFixed6) {
        return self.maker.add(self.long).min(self.short);
    }

    function takerSocialized(Order memory self) internal pure returns (UFixed6) {
        return magnitude(self).min(self.long.min(self.short).add(self.maker));
    }

    function socialized(Order memory self) internal pure returns (bool) {
        return self.maker.add(self.short).lt(self.long) || self.maker.add(self.long).lt(self.short);
    }

    function singleSided(Order memory self) internal pure returns (bool) {
        return position(self).eq(self.maker.add(self.long).add(self.short));
    }

    function maintenance(
        Order memory self,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (UFixed6) {
        return position(self).mul(currentOracleVersion.price.abs()).mul(marketParameter.maintenance);
    }

    function liquidationFee(
        Order memory self,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter,
        ProtocolParameter memory protocolParameter
    ) internal pure returns (UFixed6) {
        return maintenance(self, currentOracleVersion, marketParameter)
            .max(protocolParameter.minCollateral)
            .mul(protocolParameter.liquidationFee
        );
    }

    function sub(Order memory self, Order memory order) internal pure returns (OrderDelta memory) {
        return OrderDelta(
            Fixed6Lib.from(self.maker).sub(Fixed6Lib.from(order.maker)),
            Fixed6Lib.from(self.long).sub(Fixed6Lib.from(order.long)),
            Fixed6Lib.from(self.short).sub(Fixed6Lib.from(order.short))
        );
    }

    function add(Order memory self, OrderDelta memory orderDelta) internal pure returns (Order memory) {
        return Order(
            self.version,
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(orderDelta.maker)),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(orderDelta.long)),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(orderDelta.short))
        );
    }
}

library OrderStorageLib {
    error OrderStorageInvalidError();

    function read(OrderStorage storage self) internal view returns (Order memory) {
        StoredOrder memory storedValue =  self.value;

        return Order(
            uint256(storedValue._version),
            UFixed6.wrap(uint256(storedValue._maker)),
            UFixed6.wrap(uint256(storedValue._long)),
            UFixed6.wrap(uint256(storedValue._short))
        );
    }

    function store(OrderStorage storage self, Order memory newValue) internal {
        if (newValue.version > type(uint40).max) revert OrderStorageInvalidError();
        if (newValue.maker.gt(UFixed6Lib.MAX_72)) revert OrderStorageInvalidError();
        if (newValue.long.gt(UFixed6Lib.MAX_72)) revert OrderStorageInvalidError();
        if (newValue.short.gt(UFixed6Lib.MAX_72)) revert OrderStorageInvalidError();

        self.value = StoredOrder(
            uint40(newValue.version),
            uint72(UFixed6.unwrap(newValue.maker)),
            uint72(UFixed6.unwrap(newValue.long)),
            uint72(UFixed6.unwrap(newValue.short))
        );
    }
}