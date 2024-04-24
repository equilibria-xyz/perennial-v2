// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";

struct Price {
    Fixed6 price;
    bool valid;
}
using PriceLib for Price global;
struct StoredPrice {
    int64 price;
    bool valid;
}
struct PriceStorage { StoredPrice value; }
using PriceStorageLib for PriceStorage global;

/**
 * @title PriceLib
 * @notice Library for Price logic and data.
 */
library PriceLib {
    // @notice Returns an oracle version based on the price snapshot and timestamp
    // @param self The price snapshot object
    // @param timestamp The timestamp of the price snapshot
    // @return The corresponding oracle version
    function toOracleVersion(Price memory self, uint256 timestamp) internal pure returns (OracleVersion memory) {
        return OracleVersion(timestamp, self.price, self.valid);
    }
}

library PriceStorageLib {
    // sig: 0x2dbc6ed2
    error PriceStorageInvalidError();

    function read(PriceStorage storage self) internal view returns (Price memory) {
        StoredPrice memory storedValue = self.value;
        return Price(Fixed6.wrap(int256(storedValue.price)), storedValue.valid);
    }

    function store(PriceStorage storage self, Price memory newValue) internal {
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert PriceStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert PriceStorageInvalidError();

        self.value = StoredPrice(int64(Fixed6.unwrap(newValue.price)), newValue.valid);
    }
}
