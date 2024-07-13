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
    uint16 latestGranularity;
    uint16 currentGranularity;
    uint32 effectiveAfter;
    uint48 settlementFee;
    uint24 oracleFee;
}
struct OracleParameterStorage { StoredOracleParameter value; }
using OracleParameterStorageLib for OracleParameterStorage global;

library OracleParameterStorageLib {
    // sig: 0xfc481d85
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
