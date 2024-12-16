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

    /// @dev The minimum for market minimum maintenance parameters
    UFixed6 minMinMaintenance;
}

// struct StoredProtocolParameter {
//     /* slot 0 (28) */
//     uint24 maxFee;                  // <= 1677%
//     uint32 maxLiquidationFee;       // <= 4294
//     uint24 maxCut;                  // <= 1677%
//     uint32 maxRate;                 // <= 214748% (capped at 31 bits to accommodate int32 rates)
//     uint24 minMaintenance;          // <= 1677%
//     uint24 minEfficiency;           // <= 1677%
//     uint24 referralFee;             // <= 1677%
//     uint24 minScale;                // <= 1677%
//     uint16 maxStaleAfter;           // <= 18 hours

//     /* slot 1 (6) */
//     uint48 minMinMaintenance;       // <= 281m
// }

// SECURITY: update ProtocolParameterStorage to 2 slots.
struct ProtocolParameterStorage { uint256 slot0; uint256 slot1; }
using ProtocolParameterStorageLib for ProtocolParameterStorage global;

/// @dev (external-safe): this library is safe to externalize
library ProtocolParameterStorageLib {
    // sig: 0x4dc1bc59
    error ProtocolParameterStorageInvalidError();

    function read(ProtocolParameterStorage storage self) internal view returns (ProtocolParameter memory) {
        (uint256 slot0, uint256 slot1) = (self.slot0, self.slot1);
        return ProtocolParameter(
            UFixed6.wrap(uint256(    slot0 << (256 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(    slot0 << (256 - 24 - 32)) >> (256 - 32)),
            UFixed6.wrap(uint256(    slot0 << (256 - 24 - 32 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(    slot0 << (256 - 24 - 32 - 24 - 32)) >> (256 - 32)),
            UFixed6.wrap(uint256(    slot0 << (256 - 24 - 32 - 24 - 32 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(    slot0 << (256 - 24 - 32 - 24 - 32 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(    slot0 << (256 - 24 - 32 - 24 - 32 - 24 - 24 - 24)) >> (256 - 24)),
            UFixed6.wrap(uint256(    slot0 << (256 - 24 - 32 - 24 - 32 - 24 - 24 - 24 - 24)) >> (256 - 24)),
            uint16(                  slot0 << (256 - 24 - 32 - 24 - 32 - 24 - 24 - 24 - 24 - 16) >> (256 - 16)),
            
            UFixed6.wrap(uint256(    slot1 << (256 - 48)) >> (256 - 48))
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
        if (newValue.maxStaleAfter > uint256(type(uint16).max)) revert ProtocolParameterStorageInvalidError();
        if (newValue.minMinMaintenance.gt(UFixed6.wrap(type(uint48).max))) revert ProtocolParameterStorageInvalidError();

        uint256 encoded0 = 
            uint256(UFixed6.unwrap(newValue.maxFee)                << (256 - 24)) >> (256 - 24) |
            uint256(UFixed6.unwrap(newValue.maxLiquidationFee)     << (256 - 32)) >> (256 - 24 - 32) |
            uint256(UFixed6.unwrap(newValue.maxCut)                << (256 - 24)) >> (256 - 24 - 32 - 24) |
            uint256(UFixed6.unwrap(newValue.maxRate)               << (256 - 32)) >> (256 - 24 - 32 - 24 - 32) |
            uint256(UFixed6.unwrap(newValue.minMaintenance)        << (256 - 24)) >> (256 - 24 - 32 - 24 - 32 - 24) |
            uint256(UFixed6.unwrap(newValue.minEfficiency)         << (256 - 24)) >> (256 - 24 - 32 - 24 - 32 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.referralFee)           << (256 - 24)) >> (256 - 24 - 32 - 24 - 32 - 24 - 24 - 24) |
            uint256(UFixed6.unwrap(newValue.minScale)              << (256 - 24)) >> (256 - 24 - 32 - 24 - 32 - 24 - 24 - 24 - 24) |
            uint256(newValue.maxStaleAfter                         << (256 - 16)) >> (256 - 24 - 32 - 24 - 32 - 24 - 24 - 24 - 24 - 16);

        uint256 encoded1 = 
            uint256(UFixed6.unwrap(newValue.minMinMaintenance)     << (256 - 48)) >> (256 - 48);

        assembly {
            sstore(self.slot, encoded0)
            sstore(add(self.slot, 1), encoded1)
        }
    }
}