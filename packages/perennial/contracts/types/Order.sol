// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "@equilibria/perennial-v2-oracle/contracts/types/OracleVersion.sol";
import "./MarketParameter.sol";

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

    function update(
        Order memory self,
        Order memory newOrder,
        OracleVersion memory currentOracleVersion,
        MarketParameter memory marketParameter
    ) internal pure returns (Fixed6 makerAmount, Fixed6 longAmount, Fixed6 shortAmount, UFixed6 positionFee) {
        (makerAmount, longAmount, shortAmount) = (
            Fixed6Lib.from(newOrder.maker).sub(Fixed6Lib.from(self.maker)),
            Fixed6Lib.from(newOrder.long).sub(Fixed6Lib.from(self.long)),
            Fixed6Lib.from(newOrder.short).sub(Fixed6Lib.from(self.short))
        );
        positionFee = currentOracleVersion.price.abs().mul(
            longAmount.abs().add(shortAmount.abs()).mul(marketParameter.takerFee)
            .add(makerAmount.abs().mul(marketParameter.makerFee))
        );
        update(self, newOrder);
    }

    function update( // TODO: make a OrderDelta model?
        Order memory self,
        uint256 version,
        Fixed6 makerAmount,
        Fixed6 longAmount,
        Fixed6 shortAmount
    ) internal pure {
        update(self, Order(
            version,
            UFixed6Lib.from(Fixed6Lib.from(self.maker).add(makerAmount)),
            UFixed6Lib.from(Fixed6Lib.from(self.long).add(longAmount)),
            UFixed6Lib.from(Fixed6Lib.from(self.short).add(shortAmount))
        ));
    }

    function update(Order memory self, Order memory newOrder) internal pure {
        self.version = newOrder.version;
        self.maker = newOrder.maker;
        self.long = newOrder.long;
        self.short = newOrder.short;
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