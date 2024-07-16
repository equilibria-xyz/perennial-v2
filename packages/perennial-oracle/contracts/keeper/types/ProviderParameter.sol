// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/number/types/UFixed6.sol";
import "@equilibria/perennial-v2/contracts/types/OracleVersion.sol";

struct ProviderParameter {
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
struct StoredProviderParameter {
    uint16 latestGranularity;
    uint16 currentGranularity;
    uint32 effectiveAfter;
    uint48 settlementFee;
    uint24 oracleFee;
}
struct ProviderParameterStorage { StoredProviderParameter value; }
using ProviderParameterStorageLib for ProviderParameterStorage global;

library ProviderParameterStorageLib {
    // sig: 0x05c750c6
    error ProviderParameterStorageInvalidError();

    function read(ProviderParameterStorage storage self) internal view returns (ProviderParameter memory) {
        StoredProviderParameter memory storedValue = self.value;
        return ProviderParameter(
            uint256(storedValue.latestGranularity),
            uint256(storedValue.currentGranularity),
            uint256(storedValue.effectiveAfter),
            UFixed6.wrap(uint256(storedValue.settlementFee)),
            UFixed6.wrap(uint256(storedValue.oracleFee))
        );
    }

    function validate(ProviderParameter memory newValue) private pure {
        if (newValue.latestGranularity < 1 && newValue.effectiveAfter != 0)
            revert ProviderParameterStorageInvalidError();
        if (newValue.currentGranularity < 1) revert ProviderParameterStorageInvalidError();
    }

    function store(ProviderParameterStorage storage self, ProviderParameter memory newValue) internal {
        validate(newValue);

        if (newValue.latestGranularity > type(uint16).max) revert ProviderParameterStorageInvalidError();
        if (newValue.currentGranularity > type(uint16).max) revert ProviderParameterStorageInvalidError();
        if (newValue.effectiveAfter > type(uint32).max) revert ProviderParameterStorageInvalidError();
        if (newValue.settlementFee.gt(UFixed6.wrap(type(uint48).max))) revert ProviderParameterStorageInvalidError();
        if (newValue.oracleFee.gt(UFixed6.wrap(type(uint24).max))) revert ProviderParameterStorageInvalidError();

        self.value = StoredProviderParameter(
            uint16(newValue.latestGranularity),
            uint16(newValue.currentGranularity),
            uint32(newValue.effectiveAfter),
            uint48(UFixed6.unwrap(newValue.settlementFee)),
            uint24(UFixed6.unwrap(newValue.oracleFee))
        );
    }
}
