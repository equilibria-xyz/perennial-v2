// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { OracleVersion } from "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { PriceResponse } from "./PriceResponse.sol";

struct PriceRequest {
    /// @dev The version that is being requested
    uint256 timestamp;

    /// @dev the synchronous portion of the fixed settlement fee of the request delivered on commit
    UFixed6 syncFee;

    /// @dev the asynchronous portion of the fixed settlement fee of the request delivered on settlement callback
    UFixed6 asyncFee;

    /// @dev The relative oracle fee percentage of the request
    UFixed6 oracleFee;
}
using PriceRequestLib for PriceRequest global;
struct StoredPriceRequest {
    /* slot 0 */
    uint32 timestamp;       // <= 2038
    uint48 syncFee;         // <= 281m
    uint48 asyncFee;        // <= 281m
    uint24 oracleFee;       // <= 100%
}
struct PriceRequestStorage { StoredPriceRequest value; }
using PriceRequestStorageLib for PriceRequestStorage global;

/// @title PriceRequestLib
/// @dev (external-unsafe): this library must be used internally only
/// @notice Library for PriceRequest logic and data.
library PriceRequestLib {
    /// @notice Constructs a price response from a request and a resulting oracle version
    /// @param self The price request object
    /// @param oracleVersion The oracle version object
    /// @return The corresponding price response
    function toPriceResponse(
        PriceRequest memory self,
        OracleVersion memory oracleVersion
    ) internal pure returns (PriceResponse memory) {
        return PriceResponse(oracleVersion.price, self.syncFee, self.asyncFee, self.oracleFee, oracleVersion.valid);
    }

    /// @notice Constructs a price response from a request and the latest price response for invalid versions
    /// @param self The price request object
    /// @param latestPriceResponse The latest price response
    /// @return The corresponding price response
    function toPriceResponseInvalid(
        PriceRequest memory self,
        PriceResponse memory latestPriceResponse
    ) internal pure returns (PriceResponse memory) {
        return PriceResponse(latestPriceResponse.price, self.syncFee, self.asyncFee, self.oracleFee, false);
    }
}

/// @dev (external-safe): this library is safe to externalize
library PriceRequestStorageLib {
    // sig: 0xfc481d85
    error PriceRequestStorageInvalidError();

    function read(PriceRequestStorage storage self) internal view returns (PriceRequest memory) {
        StoredPriceRequest memory storedValue = self.value;
        return PriceRequest(
            uint256(storedValue.timestamp),
            UFixed6.wrap(uint256(storedValue.syncFee)),
            UFixed6.wrap(uint256(storedValue.asyncFee)),
            UFixed6.wrap(uint256(storedValue.oracleFee))
        );
    }

    function store(PriceRequestStorage storage self, PriceRequest memory newValue) internal {
        if (newValue.timestamp > type(uint32).max) revert PriceRequestStorageInvalidError();
        if (newValue.syncFee.gt(UFixed6.wrap(type(uint48).max))) revert PriceRequestStorageInvalidError();
        if (newValue.asyncFee.gt(UFixed6.wrap(type(uint48).max))) revert PriceRequestStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert PriceRequestStorageInvalidError();

        self.value = StoredPriceRequest(
            uint32(newValue.timestamp),
            uint48(UFixed6.unwrap(newValue.syncFee)),
            uint48(UFixed6.unwrap(newValue.asyncFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee))
        );
    }
}
