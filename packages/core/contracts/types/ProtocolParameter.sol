// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

/// @dev ProtocolParameter type
struct ProtocolParameter {
    /// @dev The maximum for market fee parameters
    UFixed6 maxFee;

    /// @dev The maximum for liquidationFee market parameter
    UFixed6 maxLiquidationFee;

    /// @dev The maximum for market cut parameters
    UFixed6 maxCut;

    /// @dev The maximum for market rate parameters
    UFixed6 maxRate;

    /// @dev The minimum for market maintenance parameters
    UFixed6 minMaintenance;

    /// @dev The minimum for market efficiency parameters
    UFixed6 minEfficiency;

    /// @dev The default referrer fee percentage for orders
    UFixed6 referralFee;

    /// @dev The minimum ratio between scale vs makerLimit / efficiencyLimit
    UFixed6 minScale;

    /// @dev The maximum for parameter restricting maximum time between oracle version and update
    uint256 maxStaleAfter;
}
struct StoredProtocolParameter {
    /* slot 0 (29) */
    uint24 maxFee;                  // <= 1677%
    uint32 maxLiquidationFee;       // <= 4294
    uint24 maxCut;                  // <= 1677%
    uint32 maxRate;                 // <= 214748% (capped at 31 bits to accommodate int32 rates)
    uint24 minMaintenance;          // <= 1677%
    uint24 minEfficiency;           // <= 1677%
    uint24 referralFee;             // <= 1677%
    uint24 minScale;                // <= 1677%
    uint24 maxStaleAfter;           // <= 4660 hours
}
struct ProtocolParameterStorage { StoredProtocolParameter value; } // SECURITY: must remain at (1) slots
using ProtocolParameterStorageLib for ProtocolParameterStorage global;

/// @dev (external-safe): this library is safe to externalize
library ProtocolParameterStorageLib {
    // sig: 0x4dc1bc59
    error ProtocolParameterStorageInvalidError();

    function read(ProtocolParameterStorage storage self) internal view returns (ProtocolParameter memory) {
        StoredProtocolParameter memory value = self.value;
        return ProtocolParameter(
            UFixed6.wrap(uint256(value.maxFee)),
            UFixed6.wrap(uint256(value.maxLiquidationFee)),
            UFixed6.wrap(uint256(value.maxCut)),
            UFixed6.wrap(uint256(value.maxRate)),
            UFixed6.wrap(uint256(value.minMaintenance)),
            UFixed6.wrap(uint256(value.minEfficiency)),
            UFixed6.wrap(uint256(value.referralFee)),
            UFixed6.wrap(uint256(value.minScale)),
            uint24(value.maxStaleAfter)
        );
    }

    function validate(ProtocolParameter memory self) internal pure {
        if (self.maxCut.gt(UFixed6Lib.ONE)) revert ProtocolParameterStorageInvalidError();
        if (self.referralFee.gt(UFixed6Lib.ONE)) revert ProtocolParameterStorageInvalidError();
        if (self.minScale.gt(UFixed6Lib.ONE)) revert ProtocolParameterStorageInvalidError();
    }

    function validateAndStore(ProtocolParameterStorage storage self, ProtocolParameter memory newValue) internal {
        validate(newValue);

        if (newValue.maxFee.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxLiquidationFee.gt(UFixed6.wrap(type(uint32).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxRate.gt(UFixed6.wrap(type(uint32).max / 2))) revert ProtocolParameterStorageInvalidError();
        if (newValue.minMaintenance.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.minEfficiency.gt(UFixed6.wrap(type(uint24).max))) revert ProtocolParameterStorageInvalidError();
        if (newValue.maxStaleAfter > uint256(type(uint24).max)) revert ProtocolParameterStorageInvalidError();

        self.value = StoredProtocolParameter(
            uint24(UFixed6.unwrap(newValue.maxFee)),
            uint32(UFixed6.unwrap(newValue.maxLiquidationFee)),
            uint24(UFixed6.unwrap(newValue.maxCut)),
            uint32(UFixed6.unwrap(newValue.maxRate)),
            uint24(UFixed6.unwrap(newValue.minMaintenance)),
            uint24(UFixed6.unwrap(newValue.minEfficiency)),
            uint24(UFixed6.unwrap(newValue.referralFee)),
            uint24(UFixed6.unwrap(newValue.minScale)),
            uint24(newValue.maxStaleAfter)
        );
    }
}