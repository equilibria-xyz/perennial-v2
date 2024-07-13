// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { OracleVersion } from "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";
import { UFixed6 } from "@equilibria/root/number/types/UFixed6.sol";
import { Fixed6 } from "@equilibria/root/number/types/Fixed6.sol";
import { PriceResponse } from "./PriceResponse.sol";

struct PriceRequest {
    /// @dev The version that is being requested
    uint256 timestamp;

    /// @dev the fixed settlement fee of the request
    UFixed6 settlementFee;

    /// @dev The relative oracle fee percentage of the request
    UFixed6 oracleFee;
}
using PriceRequestLib for PriceRequest global;
struct StoredPriceRequest {
    uint32 timestamp;
    uint48 settlementFee;
    uint24 oracleFee;
}
struct PriceRequestStorage { StoredPriceRequest value; }
using PriceRequestStorageLib for PriceRequestStorage global;

/**
 * @title PriceRequestLib
 * @notice Library for PriceRequest logic and data.
 */
library PriceRequestLib {
    /// @notice Constructs a price response from a request and a resulting oracle version
    /// @param self The price request object
    /// @param oracleVersion The oracle version object
    /// @return The corresponding price response
    function toPriceResponse(
        PriceRequest memory self,
        OracleVersion memory oracleVersion
    ) internal pure returns (PriceResponse memory) {
        return PriceResponse(oracleVersion.price, self.settlementFee, self.oracleFee, oracleVersion.valid);
    }

    /// @notice Constructs a price response from a request and the latest price response for invalid versions
    /// @param self The price request object
    /// @param latestPriceResponse The latest price response
    /// @return The corresponding price response
    function toPriceResponseInvalid(
        PriceRequest memory self,
        PriceResponse memory latestPriceResponse
    ) internal pure returns (PriceResponse memory) {
        return PriceResponse(latestPriceResponse.price, self.settlementFee, self.oracleFee, false);
    }
}

library PriceRequestStorageLib {
    // sig: 0xfc481d85
    error PriceRequestStorageInvalidError();

    function read(PriceRequestStorage storage self) internal view returns (PriceRequest memory) {
        StoredPriceRequest memory storedValue = self.value;
        return PriceRequest(
            uint256(storedValue.timestamp),
            UFixed6.wrap(uint256(storedValue.settlementFee)),
            UFixed6.wrap(uint256(storedValue.oracleFee))
        );
    }

    function store(PriceRequestStorage storage self, PriceRequest memory newValue) internal {
        if (newValue.timestamp > type(uint32).max) revert PriceRequestStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint48).max))) revert PriceRequestStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert PriceRequestStorageInvalidError();

        self.value = StoredPriceRequest(
            uint32(newValue.timestamp),
            uint48(UFixed6.unwrap(newValue.settlementFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee))
        );
    }
}
