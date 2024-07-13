// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";
import { PriceRequest } from "./PriceRequest.sol";

struct PriceResponse {
    /// @dev The oracle price of the corresponding version
    Fixed6 price;

    /// @dev the fixed settlement fee of the request
    UFixed6 settlementFee;

    /// @dev The relative oracle fee percentage of the request
    UFixed6 oracleFee;

    /// @dev Whether the version is valid
    bool valid;
}
using PriceResponseLib for PriceResponse global;
struct StoredPriceResponse {
    int64 price;
    uint48 settlementFee;
    uint24 oracleFee;
    bool valid;
}
struct PriceResponseStorage { StoredPriceResponse value; }
using PriceResponseStorageLib for PriceResponseStorage global;

/**
 * @title PriceResponseLib
 * @notice Library for PriceResponse logic and data.
 */
library PriceResponseLib {
    /// @notice Constructs a price response from an unrequested oracle version
    /// @param oracleVersion The oracle version object
    /// @return The corresponding price response
    function fromUnrequested(OracleVersion memory oracleVersion) internal pure returns (PriceResponse memory) {
        return PriceResponse(oracleVersion.price, UFixed6Lib.ZERO, UFixed6Lib.ZERO, oracleVersion.valid);
    }

    /// @notice Returns an oracle version based on the price snapshot and timestamp
    /// @param self The price snapshot object
    /// @param timestamp The timestamp of the price snapshot
    /// @return The corresponding oracle version
    function toOracleVersion(PriceResponse memory self, uint256 timestamp) internal pure returns (OracleVersion memory) {
        return OracleVersion(timestamp, self.price, self.valid);
    }
}

library PriceResponseStorageLib {
    // sig: 0xea04171b
    error PriceResponseStorageInvalidError();

    function read(PriceResponseStorage storage self) internal view returns (PriceResponse memory) {
        StoredPriceResponse memory storedValue = self.value;
        return PriceResponse(
            Fixed6.wrap(int256(storedValue.price)),
            UFixed6.wrap(uint256(storedValue.settlementFee)),
            UFixed6.wrap(uint256(storedValue.oracleFee)),
            storedValue.valid
        );
    }

    function store(PriceResponseStorage storage self, PriceResponse memory newValue) internal {
        if (newValue.price.gt(Fixed6.wrap(type(int64).max))) revert PriceResponseStorageInvalidError();
        if (newValue.price.lt(Fixed6.wrap(type(int64).min))) revert PriceResponseStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint48).max))) revert PriceResponseStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert PriceResponseStorageInvalidError();

        self.value = StoredPriceResponse(
            int64(Fixed6.unwrap(newValue.price)),
            uint48(UFixed6.unwrap(newValue.settlementFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee)),
            newValue.valid
        );
    }
}
