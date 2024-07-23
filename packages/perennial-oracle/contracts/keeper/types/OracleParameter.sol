// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";

struct OracleParameter {
    /// @dev The latest granularity setting in seconds
    uint256 latestGranularity;

    /// @dev The current granularity setting in seconds
    uint256 currentGranularity;

    /// @dev The timestamp at which the current granularity setting becomes effective
    uint256 effectiveAfter;

    /// @dev the fixed settlement fee of the request
    UFixed6 settlementFee;

    /// @dev The relative oracle fee percentage of the request
    UFixed6 oracleFee;
}
struct StoredOracleParameter {
    /* slot 0 */
    uint16 latestGranularity;   // <= 65k
    uint16 currentGranularity;  // <= 65k
    uint32 effectiveAfter;      // <= 2038
    uint48 settlementFee;       // <= 281m
    uint24 oracleFee;           // <= 100%
}
struct OracleParameterStorage { StoredOracleParameter value; }
using OracleParameterStorageLib for OracleParameterStorage global;

/// @dev (external-safe): this library is safe to externalize
library OracleParameterStorageLib {
    // sig: 0xcf1b0852
    error OracleParameterStorageInvalidError();

    function read(OracleParameterStorage storage self) internal view returns (OracleParameter memory) {
        StoredOracleParameter memory storedValue = self.value;
        return OracleParameter(
            uint256(storedValue.latestGranularity),
            uint256(storedValue.currentGranularity),
            uint256(storedValue.effectiveAfter),
            UFixed6.wrap(uint256(storedValue.settlementFee)),
            UFixed6.wrap(uint256(storedValue.oracleFee))
        );
    }

    function store(OracleParameterStorage storage self, OracleParameter memory newValue) internal {
        if (newValue.latestGranularity > type(uint16).max) revert OracleParameterStorageInvalidError();
        if (newValue.currentGranularity > type(uint16).max) revert OracleParameterStorageInvalidError();
        if (newValue.effectiveAfter > type(uint32).max) revert OracleParameterStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint48).max))) revert OracleParameterStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert OracleParameterStorageInvalidError();

        self.value = StoredOracleParameter(
            uint16(newValue.latestGranularity),
            uint16(newValue.currentGranularity),
            uint32(newValue.effectiveAfter),
            uint48(UFixed6.unwrap(newValue.settlementFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee))
        );
    }
}
