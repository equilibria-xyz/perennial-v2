// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

struct OracleParameter {
    /// @dev The cap for the granularity setting in seconds
    uint256 maxGranularity;

    /// @dev the cap for the sync fee in absolute terms
    UFixed6 maxSyncFee;

    /// @dev the cap for the async fee in absolute terms
    UFixed6 maxAsyncFee;

    /// @dev The cap for the oracle fee in relative terms
    UFixed6 maxOracleFee;
}
struct StoredOracleParameter {
    /* slot 0 */
    uint16 maxGranularity;      // <= 65k
    uint48 maxSyncFee;          // <= 281m
    uint48 maxAsyncFee;         // <= 281m
    uint24 maxOracleFee;        // <= 100%
}
struct OracleParameterStorage { StoredOracleParameter value; }
using OracleParameterStorageLib for OracleParameterStorage global;

/// @dev (external-safe): this library is safe to externalize
library OracleParameterStorageLib {
    // sig: 0xfc481d85
    error OracleParameterStorageInvalidError();

    function read(OracleParameterStorage storage self) internal view returns (OracleParameter memory) {
        StoredOracleParameter memory storedValue = self.value;
        return OracleParameter(
            uint256(storedValue.maxGranularity),
            UFixed6.wrap(uint256(storedValue.maxSyncFee)),
            UFixed6.wrap(uint256(storedValue.maxAsyncFee)),
            UFixed6.wrap(uint256(storedValue.maxOracleFee))
        );
    }

    function validate(OracleParameter memory newValue) private pure {
        if (newValue.maxGranularity < 1) revert OracleParameterStorageInvalidError();
        if (newValue.maxOracleFee.gt(UFixed6Lib.ONE)) revert OracleParameterStorageInvalidError();
    }

    function store(OracleParameterStorage storage self, OracleParameter memory newValue) internal {
        validate(newValue);

        if (newValue.maxGranularity > type(uint16).max) revert OracleParameterStorageInvalidError();
        if (newValue.maxSyncFee.gt(UFixed6.wrap(type(uint48).max))) revert OracleParameterStorageInvalidError();
        if (newValue.maxAsyncFee.gt(UFixed6.wrap(type(uint48).max))) revert OracleParameterStorageInvalidError();
        if (newValue.maxOracleFee.gt(UFixed6.wrap(type(uint24).max))) revert OracleParameterStorageInvalidError();

        self.value = StoredOracleParameter(
            uint16(newValue.maxGranularity),
            uint48(UFixed6.unwrap(newValue.maxSyncFee)),
            uint48(UFixed6.unwrap(newValue.maxAsyncFee)),
            uint24(UFixed6.unwrap(newValue.maxOracleFee))
        );
    }
}
